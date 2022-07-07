exports.constants = {
    DATABASE_NAME: process.env.TIMESTREAM_DATABASE,
    TABLE_NAME: 'left4status-table',

    // AWS Timestream storage settings
    HT_TTL_HOURS: 1,
    CT_TTL_DAYS: 120,

    // history cache time in seconds
    HISTORY_CACHE_TIMEOUT: 300,

    PANEL_REGEX: {
        spigot_tps_regex: /TPS from last 1m, 5m, 15m: (?<tps1>\S+), (?<tps5>\S+), (?<tps15>\S+)/, 
        spigot_player_regex:  /There are (?<current>\d+) of a max of (?<max>\d+) players online/, 
        bungee_player_regex: /Total players online: (?<current>\d+)/,
    },

    // role to tag in Discord webhooks
    DISCORD_ROLE: '701904205144653886',

    SERVERS: [
        {
            type: 'spigot',
            name: 'hub',
            display_name: 'Hub',
            id: '3103304e-ce00-435b-aed6-ecb335019e8a'
        },
        {
            type: 'spigot',
            name: 'survival',
            display_name: 'Survival',
            id: '340e015b-f76e-4a0f-a037-50771b90998e'
        },
        {
            type: 'spigot',
            name: 'creative',
            display_name: 'Creative',
            id: '518cfb0e-af53-46bd-9020-685def8c619c'
        },
        {
            type: 'spigot',
            name: 'partygames',
            display_name: 'Party Games',
            id: 'c3e508fd-f7f8-4d9a-85dc-ff6a69cf0575'
        },
        {
            type: 'bungee',
            name: 'bungee',
            display_name: 'Bungee',
            id: '368168d4-00b7-4966-828c-b41e85dda45e'
        },
        {
            type: 'website',
            name: 'main_website',
            display_name: 'Main Website',
            id: 'left4craft.org'
        },
        {
            type: 'website',
            name: 'wiki',
            display_name: 'Wiki',
            id: 'wiki.left4craft.org'
        },
        {
            type: 'website',
            name: 'url_shortener',
            display_name: 'URL Shortener',
            id: 'l4c.link'
        },
        {
            type: 'website',
            name: 'haste',
            display_name: 'Haste',
            id: 'haste.l4c.link'
        }
    ]
}