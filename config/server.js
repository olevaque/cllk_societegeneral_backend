module.exports = ({ env }) => ({
    host: env('HOST', '0.0.0.0'),
    port: env.int('PORT', 1337),
    url: 'https://www.escapegame-concours-ig.com/api',
    admin: {
        auth: {
        secret: env('ADMIN_JWT_SECRET', 'ed33d7719c94a7c5ee1ed03660afacff'),
        },
    },
});
