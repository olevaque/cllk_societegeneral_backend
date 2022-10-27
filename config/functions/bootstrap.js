'use strict';

/**
 * An asynchronous bootstrap function that runs before
 * your application gets started.
 *
 * This gives you an opportunity to set up your data model,
 * run jobs, or perform some special logic.
 *
 * See more details here: https://strapi.io/documentation/developer-docs/latest/setup-deployment-guides/configurations.html#bootstrap
 */

module.exports = () =>
{
    const GAME_DURATION_MINUTES = 30;
    const VOTE_DURATION_SECONDS = 30;

    const SCENE_JOINROOM = 0;
    const SCENE_READMISSION = 1;
    const SCENE_VOTECAPTAIN = 2;
    const SCENE_CHOOSECOMPANY = 3;
    const SCENE_CONGRATULATION = 4;

    const NO_VOTE = "no-vote";
    const VOTE_AGREE = "vote-agree";
    const VOTE_DISAGREE = "vote-disagree";

    //********************************************************/
    // Sockets
    const roomList = new Map();
    
    var io = require('socket.io')(strapi.server,
    {
        cors:
        {
            origin: "https://www.jeuwaterair50ans.fr/api",
            methods: ["GET", "POST"],
            allowedHeaders: ["my-custom-header"],
            credentials: true
        }
    });

    io.on("connection", socket =>
    {
        strapi.log.info("SocketConnected: ", socket.id);

        //Very useful during development:
        socket.onAny((event, ...args) =>
        {
            //console.log(event, args);
        });

        socket.on("joinSession", async(data) =>
        {
            const sessionExist = await strapi.query("session").findOne({ uuid: data.uuid });
            if (sessionExist)
            {
                if (!sessionExist.currentScene !== SCENE_CONGRATULATION)
                {
                    let pseudo = data.firstname + data.initialName;
                    if (roomList.has(data.uuid) && roomList.get(data.uuid).players.find(p => p.pseudo === pseudo))
                    {
                        socket.emit("infoSession", { status: "NOK", info: "The combo firstname, initial is already in use..." });
                    }
                    else
                    {
                        socket.room = data.uuid;
                        socket.ready = true;
    
                        joinRoom(sessionExist.uuid, socket.id, sessionExist.isVersionA, pseudo, sessionExist.currentScene, sessionExist.gameStartTime);
    
                        socket.join(sessionExist.uuid); // Le uuid unique est utilisé en tant que Room
                        socket.emit("infoSession", { status: "OK", info: "OK", currentScene: sessionExist.currentScene });
                    }
                }
                else
                {
                    socket.emit("infoSession", { status: "NOK", info: "This session is complete." });
                }
            }
            else
            {
                socket.emit("infoSession", { status: "NOK", info: "This session doesn't exist."});
            }
        });

        socket.on("WGRM_Propose", async(data) =>
        {
            if (socket.ready)
            {
                // Clean les votes et sauvegarde le vote du joueur qui propose
                startNewVote(socket.room, null);
                userVote(socket.room, socket.id, true);
    
                // Envoi a tout le monde sauf celui qui propose
                socket.to(socket.room).emit('WGRM_ShareVote');
            }
            else
            {
                console.log("WGRM_Propose: Socket not ready.");
            }
        });

        socket.on("WGVC_Propose", async(data) =>
        {
            if (socket.ready)
            {
                // Clean les votes et sauvegarde le vote du joueur qui propose
                startNewVote(socket.room, data.captain);
                userVote(socket.room, socket.id, true);
    
                // Envoi a tout le monde sauf celui qui propose
                socket.to(socket.room).emit('WGVC_ShareVote', data);
            }
            else
            {
                console.log("WGVC_Propose: Socket not ready.");
            }
        });

        socket.on("WGCC_CaptainChangeInfo", async(data) =>
        {
            if (socket.ready)
            {
                // Envoi a tout le monde sauf celui qui propose
                socket.to(socket.room).emit('WGCC_CaptainShareInfo', data);
            }
            else
            {
                console.log("WGVC_Propose: Socket not ready.");
            }
        });

        socket.on("WGCC_CaptainProposePass", async(data) =>
        {
            if (socket.ready)
            {
                if (data.password == "pass")
                {
                    io.to(socket.room).emit('WGCC_CaptainShareGoodPass', data.password);
                }
                else
                {
                    io.to(socket.room).emit('WGCC_CaptainShareBadPass', data.password);
                }
            }
            else
            {
                console.log("WGVC_Propose: Socket not ready.");
            }
        });

        socket.on("WGCC_CaptainProposeCode", async(data) =>
        {
            if (socket.ready)
            {
                if (data.code == "code")
                {
                    io.to(socket.room).emit('WGCC_CaptainShareGoodCode', data.code);
                }
                else
                {
                    io.to(socket.room).emit('WGCC_CaptainShareBadCode', data.code);
                }
            }
            else
            {
                console.log("WGVC_Propose: Socket not ready.");
            }
        });

        socket.on("WGCC_Propose", async(data) =>
        {
            if (socket.ready)
            {
                // Clean les votes et sauvegarde le vote du joueur qui propose
                startNewVote(socket.room, true);
                userVote(socket.room, socket.id, true);

                // Envoi a tout le monde sauf celui qui propose
                socket.to(socket.room).emit('WGCC_ShareVote', data);
            }
            else
            {
                console.log("WGVC_Propose: Socket not ready.");
            }
        });

        socket.on("MX_UserVote", async(data) =>
        {
            if (socket.ready)
            {
                userVote(socket.room, socket.id, data.agree);
            }
            else
            {
                console.log("MX_UserVote: Socket not ready.");
            }
        });

        socket.on("requestConnectedPlayers", async(data) =>
        {
            if (socket.ready)
            {
                shareConnectedPlayers(socket.room);
            }
            else
            {
                console.log("requestConnectedPlayers: Socket not ready.");
            }
        });

        socket.on("requestCurrentCaptain", async(data) =>
        {
            if (socket.ready)
            {
                shareCurrentCaptain(socket.room, socket.id);
            }
            else
            {
                console.log("requestCurrentCaptain: Socket not ready.");
            }
        });

        socket.on("disconnect", async(data) =>
        {
            strapi.log.info("SocketDisconnected: ", socket.id);
            if (socket.ready)
            {
                leaveRoom(socket.room, socket.id);
            }
            else
            {
                strapi.log.info("SocketDisconnected without joining.");
            }
        });
    });

    // Reinitialise et démarre un nouveau vote
    function startNewVote(room, dataForVote)
    {
        let emptyVote = [];
        roomList.get(room).players.forEach(p =>
        {
            emptyVote.push({ player: p, vote: NO_VOTE });
        });

        var roomInfo = roomList.get(room);
        roomInfo.currentVote = 
        {
            userVotes: emptyVote, 
            voteData: dataForVote,
            voteStartTime: new Date(),
        };
        roomList.set(room, roomInfo);
    }

    // Enregistre le vote d'un joueur
    function userVote(room, sockId, userAgree)
    {
        let userVote = roomList.get(room).currentVote.userVotes.find(p => p.player.psckId === sockId);
        if (userVote !== undefined)
        {
            userVote.vote = userAgree ? VOTE_AGREE : VOTE_DISAGREE;

            // Vérifie le vote
            checkVote(room);
        }
        else
        {
            console.log("UserNotFoundInVote: ", user);
        }
    }

    function checkVote(room)
    {
        // Compte le résultat du vote
        let voteNull = 0;
        let voteAgree = 0;
        let voteDisagree = 0;
        roomList.get(room).currentVote.userVotes.forEach(userVote =>
        {
            if (userVote.vote === NO_VOTE)              voteNull++;
            else if (userVote.vote === VOTE_AGREE)      voteAgree++;
            else if (userVote.vote === VOTE_DISAGREE)   voteDisagree++;
        });

        // Vérifie si le vote est terminé
        if (voteNull === 0)
        {
            if (voteAgree >= voteDisagree)
            {
                // SCENE_READMISSION 
                if (roomList.get(room).currentScene == SCENE_READMISSION)
                {
                    roomList.get(room).currentScene = sessionUpdated.currentScene;

                    strapi.query("session").update({ uuid: room }, { currentScene: SCENE_VOTECAPTAIN }).then((sessionUpdated) => 
                    {
                        io.to(room).emit('WG_NextScene', { nextScene: sessionUpdated.currentScene });
                    });
                }
                // SCENE_VOTECAPTAIN
                else if (roomList.get(room).currentScene == SCENE_VOTECAPTAIN)
                {
                    roomList.get(room).gameStartTime = sessionUpdated.gameStartTime;
                    roomList.get(room).currentScene = sessionUpdated.currentScene;
                    roomList.get(room).currentCaptain = roomList.get(room).currentVote.voteData;

                    strapi.query("session").update({ uuid: room }, { currentScene: SCENE_CHOOSECOMPANY, gameStartTime: new Date() }).then((sessionUpdated) => 
                    {
                        io.to(room).emit('WG_NextScene', { nextScene: sessionUpdated.currentScene });
                    });
                }
                // SCENE_CHOOSECOMPANY
                else if (roomList.get(room).currentScene == SCENE_CHOOSECOMPANY)
                {
                    // Send report
                    //...

                    // Review
                    strapi.query("session").update({ uuid: room }, { currentScene: SCENE_CONGRATULATION }).then((sessionUpdated) => 
                    {
                        io.to(room).emit('WG_NextScene', { nextScene: sessionUpdated.currentScene });
                    });
                }
            }
            else
            {
                io.to(room).emit('MX_VoteFail');
            }

            // Vote terminé, on le réinitialise
            roomList.get(room).currentVote = null;
        }
        else
        {
            io.to(room).emit('MX_VoteProgress', { userVotes: roomList.get(room).currentVote.userVotes });
        }
    }

    // Rejoins une room (la créer si elle n'existe pas)
    function joinRoom(room, socketid, isVA, pseudo, currentScene, sessionStartTime)
    {
        const newPlayer =
        {
            psckId: socketid,
            pseudo: pseudo,
        }

        // Créer la room si elle n'existe pas
        if (!roomList.has(room))
        {
            console.log(pseudo + " createdRoom: " + room);

            roomList.set(room, { 
                isVersionA: isVA,
                players: [],
                currentScene: currentScene,
                currentCaptain: null,
                currentVote: null,
                gameStartTime: sessionStartTime
            });

            // Si la room existant
            if (currentScene >= SCENE_CHOOSECOMPANY)
            {
                roomList.get(room).currentCaptain = newPlayer;
            }
        }
        else
        {
            console.log(pseudo + " joinedRoom: " + room);
        }
        
        // Ajoute le nouveau user à la room
        roomList.get(room).players.push(newPlayer);
        shareConnectedPlayers(room);
    }

    // Quitte une room (la detruit si on est le dernier à la quitter)
    function leaveRoom(room, socketId)
    {
        // Annule un vote si un joueur quitte
        if (roomList.get(room).currentVote !== null)
        {
            roomList.get(room).currentVote = null;
            
            console.log("VoteFail du to user left");
            io.to(room).emit("MX_VoteFail");
        }

        // User quitte la room
        let playerList = roomList.get(room).players;
        playerList = playerList.filter(u => u.psckId !== socketId);
        if (playerList.length == 0)
        {
            console.log("DeleteRoom: " + room);

            // Détruit la room si il n'y a plus d'utilisateur dedans
            roomList.delete(room);
        }
        else
        {
            console.log(socketId + " leftRoom: " + room + ". PlayersRemaining: " + playerList);

            // Si le captain a quitté, on sélectionne le captain suivant (premier joueur de la liste)
            if (roomList.get(room).currentCaptain !== null && roomList.get(room).currentCaptain.psckId === socketId)
            {
                roomList.get(room).currentCaptain = playerList[0];
                playerList.forEach(p =>
                {
                    shareCurrentCaptain(room, p.psckId);
                });
            }

            // Met a jour la room avec l'utilisateur ayant quitté en moins
            roomList.get(room).players = playerList;

            shareConnectedPlayers(room);
        }
    }

    // Envoi les informations des joueurs connectés à toute la room
    function shareConnectedPlayers(room)
    {
        io.to(room).emit('connectedPlayers', { players: roomList.get(room).players });
    }

    // Envoi l'information du captain au socket qui le demande
    function shareCurrentCaptain(room, socketId)
    {
        let yac = roomList.get(room).currentCaptain.psckId === socketId;
        io.to(socketId).emit('currentCaptain', { captain: roomList.get(room).currentCaptain, youAreCaptain: yac });
    }

    //********************************************************/
    // Timers
    setInterval(function()
    {
        roomList.forEach((values, room) =>
        {
            // Pour les rooms en cours de jeu
            if (values.currentScene == SCENE_CHOOSECOMPANY)
            {
                // Temps de jeu écoulé et déclenchement du ending
                const gameLimitTimeMs = new Date(values.gameStartTime);
                gameLimitTimeMs.setMinutes(gameLimitTimeMs.getMinutes() + GAME_DURATION_MINUTES);

                const gameMs = gameLimitTimeMs - new Date();
                const gameSeconds = Math.floor((gameMs / 1000) % 60);
                const gameMinutes = Math.floor((gameMs / 1000 / 60) % 60);

                if (gameMinutes < 0 && gameSeconds < 0)
                {
                    /*let nextScene = SCENE_CONGRATULATION;
                    strapi.query("session").update({ uuid: room }, { currentScene: nextScene }).then((sessionUpdated) => 
                    {
                        roomList.get(room).currentScene = nextScene;
                        io.to(room).emit('WG_NextScene', nextScene);
                    });*/
                }
                else
                {
                    //console.log("UpdateTimerRoom: " + gameMinutes + ":" + gameSeconds);
                    io.to(room).emit("UpdateTimerGame", { minutes: gameMinutes, seconds: gameSeconds });
                }
            }

            // Vote en cours : Temps de vote écoulé
            if (values.currentVote !== null)
            {
                const voteLimitTimeMs = new Date(values.currentVote.voteStartTime);
                voteLimitTimeMs.setSeconds(voteLimitTimeMs.getSeconds() + VOTE_DURATION_SECONDS);

                const voteSeconds = Math.floor((voteLimitTimeMs - new Date()) / 1000);
                if (voteSeconds < 0)
                {
                    // Force la fin du vote en mettant les personnes qui n'ont pas votés à "votés et acceptés"
                    let userVotes = roomList.get(room).currentVote.userVotes;
                    for (let i=0; i<userVotes.length; i++)
                    {
                        if (userVotes[i].vote === NO_VOTE)
                        {
                            userVotes[i].vote = VOTE_AGREE;
                        }
                    };
                    roomList.get(room).currentVote.userVotes = userVotes;

                    checkVote(room);
                }
                else
                {
                    io.to(room).emit("MX_VoteTimerUpdate", { seconds: voteSeconds });
                }
            }
        });
    }, 1000);
};
