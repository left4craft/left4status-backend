'use strict';

const AWS = require('aws-sdk'); // eslint-disable-line import/no-extraneous-dependencies
const https = require('https');
const agent = new https.Agent({
    maxSockets: 5000
});
const writeClient = new AWS.TimestreamWrite({
        maxRetries: 10,
        httpOptions: {
            timeout: 20000,
            agent: agent
        }
});  

const redis = require('redis');
const fetch = require('node-fetch');

const webhook = require('../util/webhook');

const constants = require('../constants').constants;
const secret = require('../secret').secret;

const Pterodactyl = require('../util/pterodactyl.js').Pterodactyl;
const api = new Pterodactyl(secret.panel.host, secret.panel.key, secret.panel.timeout, constants.PANEL_REGEX.spigot_tps_regex, constants.PANEL_REGEX.spigot_player_regex, constants.PANEL_REGEX.bungee_player_regex);

module.exports.update = async (event, context) => {
    // ensure table exists
    await createTable();

    // get a deep copy of servers
    let servers = JSON.parse(JSON.stringify(constants.SERVERS));

    // get the status of all servers
    await Promise.all(servers.map(async server => {
        if(server.type === 'spigot') {
            server.status = await api.getSpigotInfo_timeout(server.id);
        }
         else if (server.type === 'bungee') {
            server.status = await api.getBungeeInfo_timeout(server.id);
        } else if (server.type === 'website') {
            server.status = await api.getWebsiteInfo(server.id);
        }
    }));

    let records = [];
    let panel_working = true;

    // console.log(JSON.stringify(servers, null, 2))

    const time = Date.now().toString();

    for(const server of servers) {
        // ensure valid status
        if(server.status === undefined || server.status === null) {
            console.log('offline 1');
            panel_working = false;
        } else if (server.status.online == undefined || server.status.online === null) {
            console.log('offline 2');
            panel_working = false;
        } else {
            records.push({
                Dimensions: [
                    {'Name': 'type', 'Value': server.type},
                    {'Name': 'name', 'Value': server.name},
                    {'Name': 'id', 'Value': server.id},
                ],
                MeasureName: 'online',
                MeasureValue: ''+server.status.online,
                MeasureValueType: 'BOOLEAN',
                Time: time
            });

            if(server.type === 'spigot' || server.type === 'bungee') {
                if(server.status.players === undefined || server.status.players === null) {
                    console.log('offline 3');
                    panel_working = false;
                } else {
                    records.push({
                        Dimensions: [
                            {'Name': 'type', 'Value': server.type},
                            {'Name': 'name', 'Value': server.name},
                            {'Name': 'id', 'Value': server.id},
                        ],
                        MeasureName: 'players',
                        MeasureValue: ''+server.status.players,
                        MeasureValueType: 'BIGINT',
                        Time: time
                    });
                }
            }

            if(server.type === 'spigot') {
                if(server.status.tps === undefined || server.status.tps === null) {
                    console.log('offline 4');
                    panel_working = false;
                } else {
                    records.push({
                        Dimensions: [
                            {'Name': 'type', 'Value': server.type},
                            {'Name': 'name', 'Value': server.name},
                            {'Name': 'id', 'Value': server.id},
                        ],
                        MeasureName: 'tps',
                        MeasureValue: ''+server.status.tps,
                        MeasureValueType: 'DOUBLE',
                        Time: time
                    });
                }
            }
        }
    }

    records.push({
        Dimensions: [
            {'Name': 'type', 'Value': 'website'},
            {'Name': 'name', 'Value': 'panel'},
            {'Name': 'id', 'Value': 'panel.left4craft.org'},
        ],
        MeasureName: 'online',
        MeasureValue: ''+panel_working,
        MeasureValueType: 'BOOLEAN',
        Time: time
    });


    // console.log(JSON.stringify(records));

    // write the data
    await writeRecords(records);

    // send webhooks
    // do this at the end since the redis server might be down
    // but we still want to have accurate status data in the database
    const client = redis.createClient({
        socket: {
            host: secret.redis.host,
            port: secret.redis.port,
        },
        password: secret.redis.password,
    });

    // changed server statuses
    let changed = [];
    let degraded = 0;
    let offline = 0;

    await client.connect();

    // first, set up the status cache
    let cache = await client.get('status.cache');
    if(cache === null) cache = {};
    else cache = JSON.parse(cache);

    // set the panel in the cache
    if(cache.panel?.status?.online === undefined) {
        cache.panel = {
            type: "website",
            display_name: "Panel",
            id: "panel.left4craft.org",
            status: {
              "online": panel_working
            }
        };
    } else {
        cache.panel.status.online = panel_working;
    }

    for(const server of servers) {
        // if server has a valid online status
        if(server?.status?.online === false || server?.status?.online === true) {

            // create element in cache if it doesn't exist and add it
            if(!cache[server.name]) {
                cache[server.name] = {
                    type: server.type,
                    display_name: server.display_name,
                    id: server.id,
                    status: {}
                }
            }
            cache[server.name].status.online = server.status.online

        }

        // if server has valid tps status
        if(server?.status?.tps !== undefined) {
            // create element in cache if it doesn't exist and add it
            if(!cache[server.name]) {
                cache[server.name] = {
                    type: server.type,
                    display_name: server.display_name,
                    id: server.id,
                    status: {}
                }
            }
            cache[server.name].status.tps = server.status.tps
        }

        // if server has valid player count
        if(server?.status?.players !== undefined) {
            // create element in cache if it doesn't exist and add it
            if(!cache[server.name]) {
                cache[server.name] = {
                    type: server.type,
                    display_name: server.display_name,
                    id: server.id,
                    status: {}
                }
            }
            cache[server.name].status.players = server.status.players
        }
        
    }

    // set caching metadata, same name as in history to be consistent throughout API
    cache.cached = true;
    cache.cached_timestamp = new Date().getTime();

    await client.set('status.cache', JSON.stringify(cache));

    // next, sent webhooks as needed
    for(const server of servers) {
        // if server has a valid online status
        if(server?.status?.online === false || server?.status?.online === true) {
            const last_online = await getLastStatus(client, server.name, 'online', server.status.online) === 'true';

            if(server.status.online && !last_online) {
                console.log(`${server.name} is back online!`);
                changed.push({
                    name: server.display_name,
                    status: 'online'
                });
                continue; // don't show tps webhook for same server
            } else if (!server.status.online && last_online) {
                console.log(`${server.name} is now offline!`);
                changed.push({
                    name: server.display_name,
                    status: 'major'
                });
                offline += 1;
                continue; // don't show tps webhook for same server
            }
        }

        // if server has valid online and tps status
        if(server?.status?.tps !== undefined) {

            const last_tps = parseFloat(await getLastStatus(client, server.name, 'tps', server.status.tps));

            if(server.status.tps > 18 && last_tps <= 18) {
                console.log(`${server.name} is no longer experiencing degraded performance!`);
                changed.push({
                    name: server.display_name,
                    status: 'online'
                });
            } else if (server.status.tps <= 15 && last_tps > 15) {
                console.log(`${server.name} is experiencing degraded performance!`);
                changed.push({
                    name: server.display_name,
                    status: 'degraded'
                });
                degraded += 1;
            }
        }
    }

    // don't waste Redis connections!
    await client.quit();

    // overall status logic
    let overall = 'online';
    if(offline >= 2) {
        overall = 'major';
    } else if (offline > 0) {
        overall = 'minor';
    } else if (degraded > 0) {
        overall = 'degraded'
    }

    // send webhook
    if(changed.length > 0) {
        await webhook.notiify(fetch, overall, changed);
    }


    // console.log(JSON.stringify(cache, null, 2));
    return {
        statusCode: 200,
        body: JSON.stringify(cache, null, 2)
    };

};

// get the last status of the server
// warning: always returns a string!
async function getLastStatus(client, server, metric, status) {
    let last = await client.get(`last.${server}.${metric}`);
    // console.log(`Server: ${server}, Metric: ${metric}, Last: ${last}, new: ${status}`);
    await client.set(`last.${server}.${metric}`, '' + status);
    return last === null ? status : last;
}

// https://docs.aws.amazon.com/timestream/latest/developerguide/code-samples.html

async function createTable() {
  console.log("Creating Table");
  const params = {
      DatabaseName: constants.DATABASE_NAME,
      TableName: constants.TABLE_NAME,
      RetentionProperties: {
          MemoryStoreRetentionPeriodInHours: constants.HT_TTL_HOURS,
          MagneticStoreRetentionPeriodInDays: constants.CT_TTL_DAYS
      }
  };

  const promise = writeClient.createTable(params).promise();

  await promise.then(
      (data) => {
          console.log(`Table ${data.Table.TableName} created successfully`);
      },
      (err) => {
          if (err.code === 'ConflictException') {
              console.log(`Table ${params.TableName} already exists on db ${params.DatabaseName}. Skipping creation.`);
          } else {
              console.log("Error creating table. ", err);
              throw err;
          }
      }
  );
}

async function writeRecords(records) {
    console.log("Writing records");

    const params = {
        DatabaseName: constants.DATABASE_NAME,
        TableName: constants.TABLE_NAME,
        Records: records
    };

    const request = writeClient.writeRecords(params);

    await request.promise().then(
        (data) => {
            console.log("Write records successful");
        },
        (err) => {
            console.log("Error writing records:", err);
            if (err.code === 'RejectedRecordsException') {
                const responsePayload = JSON.parse(request.response.httpResponse.body.toString());
                console.log("RejectedRecords: ", responsePayload.RejectedRecords);
                console.log("Other records were written successfully. ");
            }
        }
    );
}
