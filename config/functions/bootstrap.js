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
    const GAME_DURATION_MINUTES = 20;
    const VOTE_DURATION_SECONDS = 30;

    const NO_VOTE = "no-vote";
    const VOTE_AGREE = "vote-agree";
    const VOTE_DISAGREE = "vote-disagree";

    //********************************************************/
    // CSV Parsing
    const cards = new Map();
    
    initialiseCards();

    function initialiseCards()
    {
        var fs = require("fs");
        var csv = fs.readFileSync("./data/answers.csv").toString('utf-8');

        var csvLines = csv.split('\n');
        for(var i = 1; i < csvLines.length - 1; i++)
        {
            var line = csvLines[i].split(',');
            cards.set(line[0], {
                id: line[0],
                firstname: line[1],
                lastname: line[2],
                arrivalYear: line[3],
                department: line[4],
                astrology: line[5],
                music: line[6],
                film: line[7],
                sundayActivity: line[8],
                holiday: line[9],
                pet: line[10],
                waterairValue: line[11]
            });
        }
    };

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

        /* Very useful during development:
        socket.onAny((event, ...args) =>
        {
            console.log(event, args);
        });*/

        socket.on("joinSession", async(data) =>
        {
            try
            {
                const sessionExist = await strapi.query("session").findOne({ uuid: data.uuid });
                if (sessionExist)
                {
                    if (sessionExist.isSessionStarted)
                    {
                        if (!sessionExist.isGameCompleted)
                        {
                            const pseudo = createPseudo(sessionExist.uuid);
                            
                            socket.room = data.uuid;
                            socket.pseudo = pseudo;
                            socket.ready = true;
                            socket.sessionId = sessionExist.id;
    
                            joinRoom(sessionExist.uuid, sessionExist.nbCollaboratorFound, sessionExist.score, sessionExist.timeFastestCardMs, socket.id, pseudo, sessionExist.isGameStarted, sessionExist.isGameCompleted, sessionExist.gameStartTime);
    
                            socket.join(sessionExist.uuid); // Le uuid unique est utilisé en tant que Room
                            socket.emit("infoSession", { status: "OK", info: "OK", pseudo: pseudo, isGameStarted: sessionExist.isGameStarted, isGameCompleted: sessionExist.isGameCompleted });
                        }
                        else
                        {
                            socket.emit("infoSession", { status: "NOK", info: "Cette session est terminée." });
                        }
                    }
                    else
                    {
                        socket.emit("infoSession", { status: "NOK", info: "Cette session n’est pas commencée." });
                    }
                }
                else
                {
                    socket.emit("infoSession", { status: "NOK", info: "Cette session n'existe pas"});
                }
            }
            catch(err)
            {
                console.log("error joinSession", err);
            }
        });

        socket.on("YM_Propose", async(data) =>
        {
            if (socket.ready)
            {
                // Clean les votes et sauvegarde le vote du joueur qui propose
                startNewVote(socket.room, true);
                userVote(socket.room, socket.id, socket.pseudo, true);
    
                // Envoi a tout le monde sauf celui qui propose
                data.shareSentence = "L'équipe propose de démarrer la partie.";
                socket.to(socket.room).emit('YM_ShareVote', data);
            }
            else
            {
                console.log("YM_Propose: Socket not ready.");
            }
        });

        socket.on("TG_Propose", async(data) =>
        {
            if (socket.ready)
            {
                const propositionIsGood = data.goodCard.id === roomList.get(socket.room).currentQuestion.goodCard.id;
    
                // Clean les votes et sauvegarde le vote du joueur qui propose
                startNewVote(socket.room, propositionIsGood);
                userVote(socket.room, socket.id, socket.pseudo, true);
    
                // Envoi a tout le monde sauf celui qui propose
                data.shareSentence = "L'équipe propose la solution suivante.";
                socket.to(socket.room).emit('TG_ShareVote', data);
            }
            else
            {
                console.log("TG_Propose: Socket not ready.");
            }
        });

        socket.on("requestAllCardsForDebug", async(data) =>
        {
            let cardArray = Array.from(cards.values());
            //socket.emit("allCardsForDebug", { cards: cardArray.slice(0, 140) });
            socket.emit("allCardsForDebug", { cards: cardArray.slice(140, cards.length) });
        });

        socket.on("requestUpdateGameData", async(data) =>
        {
            if (socket.ready)
            {
                var gameData = getGameData(socket.room);
                socket.emit("updateGameData", gameData);
            }
            else
            {
                console.log("requestCards: Socket not ready.");
            }
        });

        socket.on("MX_UserVote", async(data) =>
        {
            if (socket.ready)
            {
                userVote(socket.room, socket.id, socket.pseudo, data.agree);
            }
            else
            {
                console.log("MX_UserVote: Socket not ready.");
            }
        });

        socket.on("requestConnectedUsers", async(data) =>
        {
            if (socket.ready)
            {
                shareUsersState(socket.room);
            }
            else
            {
                console.log("RequestConnectedUsers: Socket not ready.");
            }
        });

        socket.on("requestStatistics", async(data) =>
        {
            if (socket.ready)
            {
                strapi.query("session").findOne({ uuid: socket.room }).then((sessionExist) =>
                {
                    if (sessionExist)
                    {
                        let cardArray = Array.from(cards.values());
                        let depCards = cardArray.filter(c => c.department === data.department);
                        depCards.sort((a, b) => { return b.arrivalYear - a.arrivalYear; });

                        let objToSend = { 
                            nbCollaboratorFound: sessionExist.nbCollaboratorFound,
                            score: sessionExist.score,
                            fastestCardFound: roomList.get(socket.room).fastestCard,
                            timeFastestCardMs: sessionExist.timeFastestCardMs,
                            departmentCards: depCards,
                        };
                        socket.emit('Statistics', objToSend);
                    }
                });
            }
            else
            {
                console.log("requestStatistics: Socket not ready.");
            }
        });

        socket.on("requestScore", async(data) =>
        {
            if (socket.ready)
            {
                strapi.query("session").findOne({ uuid: socket.room }).then((sessionExist) =>
                {
                    if (sessionExist) socket.emit('UpdateScore', { score: sessionExist.score });
                });
            }
            else
            {
                console.log("requestScore: Socket not ready.");
            }
        });

        socket.on("requestRateAndComment", async(data) =>
        {
            if (socket.ready)
            {
                const rateDef =
                {
                    stars: data.rateStar,
                    comment: data.comment,
                    session: socket.sessionId,
                }
                strapi.query("rate").create(rateDef).then((rateCreated) => {});
            }
            else
            {
                console.log("requestRateAndComment: Socket not ready.");
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
    function startNewVote(room, propositionIsGood)
    {
        let emptyVote = [];
        roomList.get(room).socketIds.forEach(sockid =>
        {
            emptyVote.push({ socketId: sockid, vote: NO_VOTE });
        });

        var roomInfo = roomList.get(room);
        roomInfo.currentVote = 
        {
            userVotes: emptyVote, 
            propositionIsGoodAnswer: propositionIsGood,
            voteStartTime: new Date(),
        };
        roomList.set(room, roomInfo);
    }

    // Enregistre le vote d'un joueur
    function userVote(room, sockId, pseudo, userAgree)
    {
        let userVote = roomList.get(room).currentVote.userVotes.find(v => v.socketId === sockId);
        if (userVote !== undefined)
        {
            userVote.pseudo = pseudo;
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
                // Jeu non commencé
                if (!roomList.get(room).isGameStarted)
                {
                    strapi.query("session").update({ uuid: room }, { isGameStarted: true, gameStartTime: new Date() }).then((sessionUpdated) => 
                    {
                        roomList.get(room).gameStartTime = sessionUpdated.gameStartTime;
                        roomList.get(room).isGameStarted = sessionUpdated.isGameStarted;
                        io.to(room).emit('GotoTheGame');
                    });
                }
                // Jeu en cours
                else
                {
                    if (roomList.get(room).currentVote.propositionIsGoodAnswer)
                    {
                        var elapsedTime = new Date() - new Date(roomList.get(room).currentQuestion.questionStartTime);
                        var fastestCard = Math.min(elapsedTime, roomList.get(room).timeFastestCardMs);
                        if (fastestCard < roomList.get(room).timeFastestCardMs)
                        {
                            roomList.get(room).fastestCard = roomList.get(room).currentQuestion.goodCard;
                        }

                        strapi.query("session").update({ uuid: room }, { nbCollaboratorFound: roomList.get(room).nbCollaboratorFound + 1, score: roomList.get(room).currentScore + 10, timeFastestCardMs: fastestCard }).then((sessionUpdated) => 
                        {
                            roomList.get(room).timeFastestCardMs = sessionUpdated.timeFastestCardMs;
                            roomList.get(room).nbCollaboratorFound = sessionUpdated.nbCollaboratorFound;
                            roomList.get(room).currentScore = sessionUpdated.score;
                            io.to(room).emit('MX_VoteGoodAnswer', { score: sessionUpdated.score });

                            selectNextCardToFind(room);
                        });
                    }
                    else
                    {
                        strapi.query("session").update({ uuid: room }, { score: roomList.get(room).currentScore - 1 }).then((sessionUpdated) => 
                        {
                            roomList.get(room).currentScore = sessionUpdated.score;
                            io.to(room).emit('MX_VoteBadAnswer', { score: sessionUpdated.score });
                        });
                    }
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

    // Selectionne les cartes suivantes à trouver
    function selectNextCardToFind(room)
    {
        if (roomList.has(room))
        {
            var roomInfo = roomList.get(room);

            // Ajoute la précédente bonne réponse dans les réponses trouvées
            var foundedCardIds = [];
            if (roomInfo.currentQuestion !== null)
            {
                foundedCardIds = roomInfo.currentQuestion.foundedCardIds;
                foundedCardIds.push(roomInfo.currentQuestion.goodCard.id);
            }
            
            var nbCollabFound = roomInfo.nbCollaboratorFound;
            var nbCardRequested = 0;
            var nbCommonPoint = 0;

            if (nbCollabFound >= 0 && nbCollabFound < 6)            nbCardRequested = 8;
            else if (nbCollabFound >= 6 && nbCollabFound < 10)      nbCardRequested = 12;
            else if (nbCollabFound >= 10 && nbCollabFound < 20)     nbCardRequested = 16;
            else if (nbCollabFound >= 20 && nbCollabFound < 30)     nbCardRequested = 20;
            else                                                    nbCardRequested = 24;

            if (nbCollabFound >= 0 && nbCollabFound < 2)            nbCommonPoint = 2;
            else if (nbCollabFound >= 2 && nbCollabFound < 7)       nbCommonPoint = 3;
            else if (nbCollabFound >= 7 && nbCollabFound < 11)      nbCommonPoint = 4;
            else if (nbCollabFound >= 11 && nbCollabFound < 16)     nbCommonPoint = 5;
            else                                                    nbCommonPoint = 6;

            // Copie la liste des cartes et supprimer les cartes déjà trouvés
            let copyCards = new Map(cards);
            foundedCardIds.forEach(key => {
                copyCards.delete(key);
            });

            // Randomise une carte dans la liste restante
            let copyCardArray = Array.from(copyCards.values());
            let nextCardToFind = copyCardArray[Math.floor(Math.random() * copyCardArray.length)];

            // Supprime également la carte à trouver
            copyCardArray = copyCardArray.filter(cc => cc.id !== nextCardToFind.id);
            
            let similar0Elem = [];  // Tableau des cartes ayant 2 points communs
            let similar1Elem = [];  // Tableau des cartes ayant 2 points communs
            let similar2Elem = [];  // Tableau des cartes ayant 2 points communs
            let similar3Elem = [];  // Tableau des cartes ayant 3 points communs
            let similar4Elem = [];  // Tableau des cartes ayant 4 points communs
            let similar5Elem = [];  // Tableau des cartes ayant 5 points communs
            let similar6Elem = [];  // Tableau des cartes ayant 6 points communs

            // Pour chaque carte, calcule le pourcentage de similitude par rapport à la carte à trouver
            copyCardArray.forEach(card =>
            {
                let similarity = 0;
                if (card.arrivalYear == nextCardToFind.arrivalYear)         similarity += 1;
                if (card.department == nextCardToFind.department)           similarity += 1;
                if (card.astrology == nextCardToFind.astrology)             similarity += 1;
                if (card.music == nextCardToFind.music)                     similarity += 1;
                if (card.film == nextCardToFind.film)                       similarity += 1;
                if (card.sundayActivity == nextCardToFind.sundayActivity)   similarity += 1;
                if (card.holiday == nextCardToFind.holiday)                 similarity += 1;
                if (card.pet == nextCardToFind.pet)                         similarity += 1;
                if (card.waterairValue == nextCardToFind.waterairValue)     similarity += 1;

                if (similarity == 0) similar0Elem.push(card);
                if (similarity == 1) similar1Elem.push(card);
                if (similarity == 2) similar2Elem.push(card);
                if (similarity == 3) similar3Elem.push(card);
                if (similarity == 4) similar4Elem.push(card);
                if (similarity == 5) similar5Elem.push(card);
                if (similarity == 6) similar6Elem.push(card);
            });

            /*
            console.log("NbCommonPoints: " + nbCommonPoint);
            console.log("2 similitudes: " + similar2Elem.length + " / " + copyCardArray.length);
            console.log("3 similitudes: " + similar3Elem.length + " / " + copyCardArray.length);
            console.log("4 similitudes: " + similar4Elem.length + " / " + copyCardArray.length);
            console.log("5 similitudes: " + similar5Elem.length + " / " + copyCardArray.length);
            console.log("6 similitudes: " + similar6Elem.length + " / " + copyCardArray.length);
            */

            // Initialise les cartes dont une carte sera la carte a trouver et les autres des cartes similaires
            let collaboratorCards = [];
            collaboratorCards.push(nextCardToFind);

            if (nbCommonPoint == 6)
            {
                collaboratorCards.push(...similar6Elem);
                if (collaboratorCards.length < nbCardRequested) collaboratorCards.push(...similar5Elem);
                if (collaboratorCards.length < nbCardRequested) collaboratorCards.push(...similar4Elem);
                if (collaboratorCards.length < nbCardRequested) collaboratorCards.push(...similar3Elem);
                if (collaboratorCards.length < nbCardRequested) collaboratorCards.push(...similar2Elem);
                if (collaboratorCards.length < nbCardRequested) collaboratorCards.push(...similar1Elem);
                if (collaboratorCards.length < nbCardRequested) collaboratorCards.push(...similar0Elem);
            }
            else if (nbCommonPoint == 5)
            {
                collaboratorCards.push(...similar5Elem);
                if (collaboratorCards.length < nbCardRequested) collaboratorCards.push(...similar4Elem);
                if (collaboratorCards.length < nbCardRequested) collaboratorCards.push(...similar3Elem);
                if (collaboratorCards.length < nbCardRequested) collaboratorCards.push(...similar2Elem);
                if (collaboratorCards.length < nbCardRequested) collaboratorCards.push(...similar1Elem);
                if (collaboratorCards.length < nbCardRequested) collaboratorCards.push(...similar0Elem);
            }
            else if (nbCommonPoint == 4)
            {
                collaboratorCards.push(...similar4Elem);
                if (collaboratorCards.length < nbCardRequested) collaboratorCards.push(...similar3Elem);
                if (collaboratorCards.length < nbCardRequested) collaboratorCards.push(...similar2Elem);
                if (collaboratorCards.length < nbCardRequested) collaboratorCards.push(...similar1Elem);
                if (collaboratorCards.length < nbCardRequested) collaboratorCards.push(...similar0Elem);
            }
            else if (nbCommonPoint == 3)
            {
                collaboratorCards.push(...similar3Elem);
                if (collaboratorCards.length < nbCardRequested) collaboratorCards.push(...similar2Elem);
                if (collaboratorCards.length < nbCardRequested) collaboratorCards.push(...similar1Elem);
                if (collaboratorCards.length < nbCardRequested) collaboratorCards.push(...similar0Elem);
            }
            else if (nbCommonPoint == 2)
            {
                collaboratorCards.push(...similar2Elem);
                if (collaboratorCards.length < nbCardRequested) collaboratorCards.push(...similar1Elem);
                if (collaboratorCards.length < nbCardRequested) collaboratorCards.push(...similar0Elem);
            }

            // Garde les X premières cartes
            collaboratorCards = collaboratorCards.slice(0, nbCardRequested);

            // Mélange les cartes
            for(let i = collaboratorCards.length - 1; i >= 1; i--)
            {
                let j = Math.floor(Math.random() * (i + 1)); // 0 <= j <= i
                let temp = collaboratorCards[j];
                collaboratorCards[j] = collaboratorCards[i];
                collaboratorCards[i] = temp;
            }

            roomInfo.currentQuestion =
            {
                goodCard: nextCardToFind,
                cardList: collaboratorCards,
                foundedCardIds: foundedCardIds,
                questionStartTime: new Date(),
            };

            roomList.set(room, roomInfo);

            // Envoi la mise à jour des cartes à tout le monde
            var gameData = getGameData(room);
            io.to(room).emit("updateGameData", gameData);
        }
        else
        {
            console.log("WTF ???");
        }
    }

    // Rejoins une room (la créer si elle n'existe pas)
    function joinRoom(room, nbCollabFound, score, fastest, socketid, pseudo, isInGame, isGameCompleted, sessionStartTime)
    {
        // Créer la room si elle n'existe pas
        if (!roomList.has(room))
        {
            //console.log(pseudo + " createdRoom: " + room);

            roomList.set(room, { 
                socketIds: [],
                isGameStarted: isInGame,
                isGameCompleted: isGameCompleted,
                gameStartTime: sessionStartTime,
                timeFastestCardMs: fastest,
                fastestCard: null,
                nbCollaboratorFound: nbCollabFound,
                currentScore: score,
                currentVote: null,
                currentQuestion: null
            });

            selectNextCardToFind(room);
        }
        else
        {
            //console.log(pseudo + " joinedRoom: " + room);
        }
        
        // Ajoute le nouveau user à la room
        roomList.get(room).socketIds.push(socketid);
        shareUsersState(room);
    }

    // Quitte une room (la detruit si on est le dernier à la quitter)
    function leaveRoom(room, socketId)
    {
        // Annule un vote si un joueur quitte
        if (roomList.get(room).currentVote !== null)
        {
            roomList.get(room).currentVote = null;
            
            //console.log("VoteFail du to user left");
            io.to(room).emit("MX_VoteFail");
        }

        // User quitte la room
        let socketList = roomList.get(room).socketIds;
        socketList = socketList.filter(u => u !== socketId);
        if (socketList.length == 0)
        {
            //console.log("DeleteRoom: " + room);

            // Détruit la room si il n'y a plus d'utilisateur dedans
            roomList.delete(room);
        }
        else
        {
            //console.log(socketId + " leftRoom: " + room + ". PlayersRemaining: " + socketList);

            // Met a jour la room avec l'utilisateur ayant quitté en moins
            var roomInfo = roomList.get(room);
            roomInfo.socketIds = socketList;
            roomList.set(room, roomInfo);

            shareUsersState(room);
        }
    }

    // Vérifie si un pseudo existe déjà dans la room
    function createPseudo(room)
    {
        if (roomList.has(room))
        {
            let idUser = 0;

            let userList = roomList.get(room).socketIds;
            while (userList.find(u => u === ("PLAYER_" + idUser)) !== undefined)
            {
                idUser++;
            }
            return "PLAYER_" + idUser;
        }
        else
        {
            return "PLAYER_0";
        }
    }

    // Envoi les informations des joueurs connectés à toute la room
    function shareUsersState(room)
    {
        io.to(room).emit('connectedUsers', { users: roomList.get(room).socketIds });
    }

    function getGameData(room)
    {
        var gameData = {
            nbCollaboratorFound: roomList.get(room).nbCollaboratorFound,
            cards: roomList.get(room).currentQuestion.cardList,
        };
        return gameData;
    }

    //********************************************************/
    // Timers
    setInterval(function()
    {
        roomList.forEach((values, room) =>
        {
            // Pour les rooms en cours de jeu
            if (values.isGameStarted && !values.isGameCompleted)
            {
                // Temps de jeu écoulé et déclenchement du ending
                const gameLimitTimeMs = new Date(values.gameStartTime);
                gameLimitTimeMs.setMinutes(gameLimitTimeMs.getMinutes() + GAME_DURATION_MINUTES);

                const gameMs = gameLimitTimeMs - new Date();
                const gameSeconds = Math.floor((gameMs / 1000) % 60);
                const gameMinutes = Math.floor((gameMs / 1000 / 60) % 60);

                if (gameMinutes < 0 && gameSeconds < 0)
                {
                    strapi.query("session").update({ uuid: room }, { isGameCompleted: true }).then((sessionUpdated) => 
                    {
                        roomList.get(room).isGameCompleted = sessionUpdated.isGameCompleted;
                        io.to(room).emit('TG_GameEnding');
                    });
                }
                else
                {
                    //console.log("UpdateTimerRoom: " + gameMinutes + ":" + gameSeconds);
                    io.to(room).emit("updateTimerGame", { minutes: gameMinutes, seconds: gameSeconds });
                }

                // Temps de vote écoulé
                if (values.currentVote !== null)
                {
                    const voteLimitTimeMs = new Date(values.currentVote.voteStartTime);
                    voteLimitTimeMs.setSeconds(voteLimitTimeMs.getSeconds() + VOTE_DURATION_SECONDS);

                    const voteSeconds = Math.floor((voteLimitTimeMs - new Date()) / 1000);
                    if (voteSeconds < 0)
                    {
                        //console.log("ForceVote: ");

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
                        //console.log("MX_VoteTimerUpdate:" + voteSeconds);
                        io.to(room).emit("MX_VoteTimerUpdate", { seconds: voteSeconds });
                    }
                }

                // Envoi des indices
                if (values.currentQuestion !== null)
                {
                    const cardForClue = cards.get(values.currentQuestion.goodCard.id);

                    const questionStartTimeSec = Math.floor(new Date() - new Date(values.currentQuestion.questionStartTime)) / 1000;

                    var clues = [];
                    if (questionStartTimeSec >= 5 && questionStartTimeSec < 35)
                    {
                        clues = getWave1Clues(cardForClue);
                    }
                    else if (questionStartTimeSec >= 35 && questionStartTimeSec < 90)
                    {
                        clues = getWave2Clues(cardForClue);
                    }
                    else if (questionStartTimeSec >= 90 && questionStartTimeSec < 120)
                    {
                        clues = getWave3Clues(cardForClue);
                    }
                    else if (questionStartTimeSec >= 120)
                    {
                        clues = getWave4Clues(cardForClue);
                    }

                    // Distribue les indices aux joueurs
                    var nbPlayers = values.socketIds.length;
                    var cptPlayer = 0;
                    var socketClues = {};
                    
                    values.socketIds.forEach(socketId =>
                    {
                        socketClues[socketId] = [];
                    });
                       
                    // Offset les indices pour qu'a chaque question, un joueur est un indice différent
                    cptPlayer += values.nbCollaboratorFound % nbPlayers;
                    clues.forEach(clue =>
                    {
                        if (cptPlayer >= nbPlayers)
                        {
                            cptPlayer = 0;
                        }
                        var socketId = values.socketIds[cptPlayer];
                        socketClues[socketId].push(clue);

                        cptPlayer++;
                    });

                    for (var sockId in socketClues)
                    {
                        //console.log("Send: ", socketClues[sockId]);
                        // Si le joueur n'a pas reçu d'indice car il n'y en a pas assez (5joueurs et + pour 4 indices)
                        // Fourni un indice au joueur
                        if (socketClues[sockId].length == 0)
                        {
                            socketClues[sockId].push(clues[values.nbCollaboratorFound % 4]);
                        }

                        io.to(sockId).emit("updateCluesData", { clues: socketClues[sockId] });
                    }
                }
            }
        });
    }, 1000);

    function getWave1Clues(cardForClue)
    {
        var clues = [];
        clues.push(cardForClue.pet);
        clues.push(cardForClue.holiday);
        clues.push(cardForClue.music);
        clues.push(cardForClue.film);
        return clues;
    }

    function getWave2Clues(cardForClue)
    {
        var clues = [];
        clues.push(cardForClue.pet);
        clues.push(cardForClue.holiday);
        clues.push(cardForClue.music);
        clues.push(cardForClue.film);

        clues.push(cardForClue.astrology);
        clues.push(cardForClue.sundayActivity);
        clues.push(cardForClue.waterairValue);
        clues.push(cardForClue.department);
        return clues;
    }

    function getWave3Clues(cardForClue)
    {
        var clues = [];
        clues.push(cardForClue.pet);
        clues.push(cardForClue.holiday);
        clues.push(cardForClue.music);
        clues.push(cardForClue.film);

        clues.push(cardForClue.astrology);
        clues.push(cardForClue.sundayActivity);
        clues.push(cardForClue.waterairValue);
        clues.push(cardForClue.department);

        clues.push(cardForClue.arrivalYear);
        clues.push(cardForClue.firstname);
        return clues;
    }

    function getWave4Clues(cardForClue)
    {
        var clues = [];
        clues.push(cardForClue.pet);
        clues.push(cardForClue.holiday);
        clues.push(cardForClue.music);
        clues.push(cardForClue.film);

        clues.push(cardForClue.astrology);
        clues.push(cardForClue.sundayActivity);
        clues.push(cardForClue.waterairValue);
        clues.push(cardForClue.department);

        clues.push(cardForClue.arrivalYear);
        clues.push(cardForClue.firstname);
        
        clues.push(cardForClue.lastname);
        return clues;
    }
};
