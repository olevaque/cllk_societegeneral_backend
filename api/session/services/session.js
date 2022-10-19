'use strict';

/**
 * Read the documentation (https://strapi.io/documentation/developer-docs/latest/development/backend-customization.html#core-services)
 * to customize this service
 */

module.exports =
{
    getStartedSessionByPassword: async(sessionPass) =>
    {
        const session = await strapi.query("session").findOne({ password: sessionPass });
        return session;
    }
};
