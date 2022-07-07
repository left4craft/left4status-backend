const fetch = require('node-fetch');
const WebSocketClient = require('websocket').client;

class Pterodactyl {
    constructor(host, key, timeout, spigot_tps_regex, spigot_player_regex, bungee_player_regex) {
        if(host[host.length - 1] !== '/') host += '/';
        this.host = host;
        this.key = key;
        this.timeout = timeout;
        this.spigot_tps_regex = spigot_tps_regex;
        this.spigot_player_regex = spigot_player_regex;
        this.bungee_player_regex = bungee_player_regex;

        this.client = this.host + 'api/client';
        this.headers = {
            'Accept': 'Application/vnd.pterodactyl.v1+json',
            'Authorization': `Bearer ${this.key}`,
            'Content-Type': 'application/json'
        };
    }

    async getServers() {
        const endpoint = this.client;

        const controller = new AbortController();
        let timeout = setTimeout(() => {
        	controller.abort();
        }, this.timeout);

        try {
            let response = await fetch(endpoint, {
                headers: this.headers
            });
            response = await response.json();
            // console.log(response);

            let server_ids = {}
            for(const server of response.data) {
                if(server.object === 'server') {
                    server_ids[server.attributes.name] = server.attributes.uuid;
                }
            }


            return server_ids;
        } catch (error) {
            console.log('API error:');
            console.error(error);
        } finally {
            clearTimeout(timeout)
        }
    }

    async getPowerState(server) {
        const endpoint = `${this.client}/servers/${server}/resources`;

        const controller = new AbortController();
        let timeout = setTimeout(() => {
        	controller.abort();
        }, this.timeout);

        try {
            let response = await fetch(endpoint, {
                headers: this.headers,
                signal: controller.signal
            });
            response = await response.json();
            // console.log(response);
            return response.attributes.current_state;
        } catch (error) {
            // this can happen if the server is offline, even if the panel is online
            console.log('API error 2');
            console.error(error);
            return null;
        } finally {
            clearTimeout(timeout);
        }
        return null;
    }

    // async function
    getSpigotInfo(server) {

        let retVal = { online: true };

        // "this" is not accessable within promise scope
        const spigot_tps_regex = this.spigot_tps_regex;
        const spigot_player_regex = this.spigot_player_regex;

        return new Promise(async resolve => {
            const powerState = await this.getPowerState(server) ;
            if(powerState !== 'running') {
                // if power state is null, the server could be offline
                // if(powerState === null) resolve({ online: null });
                resolve({ online: false, players: 0, tps: 0 });
                return;
            }

            const endpoint = `${this.client}/servers/${server}/websocket`;
    
            try {
                let response = await fetch(endpoint, {
                    headers: this.headers
                });
                response = await response.json();
                // console.log(response);
    
                const ws = new WebSocketClient();

                ws.on('connect', function open(connection) {
                    connection.sendUTF(JSON.stringify({
                        'event': 'auth',
                        'args': [response.data.token]
                    }));

                    connection.on('message', function message(data) {
                        data = JSON.parse(data.utf8Data);

                        if(data.event === 'auth success') {
                            connection.sendUTF(JSON.stringify({
                                'event': 'send command',
                                'args': ['tps']
                            }));
                            connection.sendUTF(JSON.stringify({
                                'event': 'send command',
                                'args': ['minecraft:list']
                            }));
        
                        // @TODO write a plugin to paste this info in a parseable format instead of doing this
                        } else if (data.event === 'console output') {
        
                            // https://stackoverflow.com/questions/25245716/remove-all-ansi-colors-styles-from-strings
                            const output = data.args[0].replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
        
                            if(output.includes('issued server command')) return;
                            
                            if(output.match(spigot_tps_regex)) {
                                retVal.tps = parseFloat(spigot_tps_regex.exec(output).groups.tps5);
                                if(retVal.players !== undefined) {
                                    resolve(retVal);
                                    connection.close();
                                }
                            }
                            
                            if (output.match(spigot_player_regex)) {
                                retVal.players = parseInt(spigot_player_regex.exec(output).groups.current);
                                if(retVal.tps !== undefined) {
                                    resolve(retVal);
                                    connection.close();
                                }
                            }
        
                        }

                        connection.on('error', function(error) {
                            console.log("Connection Error: " + error.toString());
                            resolve(null);
                        });
                    });
                });

                ws.on('connectFailed', function(error) {
                    console.log('Connect Error: ' + error.toString());
                    resolve(null);
                });

                ws.connect(response.data.socket, null,  this.host.slice(0, -1), this.headers);
    
                return response.data;
            } catch (error) {
                console.log('API error 3');
                console.log(error);
                resolve(null);
            }
            resolve(null);    
        });
    }

    // async function
    getBungeeInfo(server) {

        // "this" is not accessable within promise scope
        const bungee_player_regex = this.bungee_player_regex;

        return new Promise(async resolve => {
            const powerState = await this.getPowerState(server) ;
            if(powerState !== 'running') {
                // if(powerState === null) resolve({ online: null });
                resolve({ online: false, players: 0 });
                return;
            }

            const endpoint = `${this.client}/servers/${server}/websocket`;
    
            try {
                let response = await fetch(endpoint, {
                    headers: this.headers
                });
                response = await response.json();
                // console.log(response);
    
                const ws = new WebSocketClient();
    
                ws.on('connect', function open(connection) {
                    connection.sendUTF(JSON.stringify({
                        'event': 'auth',
                        'args': [response.data.token]
                    }));

                    connection.on('message', function message(data) {
                        data = JSON.parse(data.utf8Data);
                        if(data.event === 'auth success') {
                            connection.sendUTF(JSON.stringify({
                                'event': 'send command',
                                'args': ['glist']
                            }));
        
                        // @TODO write a plugin to paste this info in a parseable format instead of doing this
                        } else if (data.event === 'console output') {
        
                            // https://stackoverflow.com/questions/25245716/remove-all-ansi-colors-styles-from-strings
                            const output = data.args[0].replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');

                            if(output.match(bungee_player_regex)) {
                                resolve( { online: true, players: parseInt(bungee_player_regex.exec(output).groups.current) } );
                                connection.close();
                                return;
                            }
        
                        }
                    });

                    connection.on('error', function(error) {
                        console.log("Connection Error: " + error.toString());
                        resolve(null);
                    });

                });

                ws.on('connectFailed', function(error) {
                    console.log('Connect Error: ' + error.toString());
                    resolve(null);
                });
    
                ws.connect(response.data.socket, null,  this.host.slice(0, -1), this.headers);

                return response.data;
            } catch (error) {
                console.log('API error 4');
                console.log(error);
            }

            // KEEP RESOLVE OUTSIDE OF FINALLY
            resolve(null);
        });
    }

    async getWebsiteInfo(domain) {
        const endpoint = `https://${domain}`;

        const controller = new AbortController();
        let timeout = setTimeout(() => {
        	controller.abort();
        }, this.timeout);

        try {
            await fetch(endpoint, {
                signal: controller.signal
            });
            return { online: true };
        } catch (error) {
            console.error(error);
        } finally {
            clearTimeout(timeout);
        }
        return { online: false };
    }

    // functions with timeouts

    async getSpigotInfo_timeout(server) {
        return await Promise.race([
            this.getSpigotInfo(server),
            new Promise(resolve => setTimeout(() => resolve(null), this.timeout))
        ]);   
    }

    async getBungeeInfo_timeout(server) {
        return await Promise.race([
            this.getBungeeInfo(server),
            new Promise(resolve => setTimeout(() => resolve(null), this.timeout))
        ]);   
    }
}


exports.Pterodactyl = Pterodactyl;