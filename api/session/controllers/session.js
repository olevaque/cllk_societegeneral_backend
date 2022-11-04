'use strict';

/**
 * Read the documentation (https://strapi.io/documentation/developer-docs/latest/development/backend-customization.html#core-controllers)
 * to customize this controller
 */

module.exports =
{
    createUniqueSession: async (ctx) =>
    {
        if (ctx.state.user)
        {
            const uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c)
            {
                var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            });

            const mData = ctx.request.body;
            const sessionDef =
            {
                uuid: uuid,
                name: mData.name,
                animator: ctx.state.user.id,

                isSessionStarted: false,
                isGameStarted: false,
                isGameCompleted: false,
                
                currentScene: 1,
                currentStep: 0,
                isVersionA: mData.isVersionA
            }
            return await strapi.query("session").create(sessionDef);
        }
        else
        {
            ctx.unauthorized("You are not logged in !");
        }
    }
};
