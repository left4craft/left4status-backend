'use strict';

const redis = require('redis');
const secret = require('../secret').secret;

module.exports.status = async (event, context) => {

    const client = redis.createClient({
        socket: {
            host: secret.redis.host,
            port: secret.redis.port,
        },
        password: secret.redis.password,
    });

    await client.connect();

    const status = await client.get('status.cache');

    // don't waste Redis connections!
    await client.quit();

    return {
        statusCode: 200,
        headers: {
            'Content-Type': 'application/json'
        },
        body: status
    };

};
