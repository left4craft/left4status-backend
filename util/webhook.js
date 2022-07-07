const secret = require('../secret').secret;
const constants = require('../constants').constants;

const webhook = secret.discord_webhook;
const role = constants.DISCORD_ROLE;

const statuses = {
	online: {
		colour: '00c800',
		emoji: ':green_square:',
		info: 'is online',
		title: 'Online'
	},
	degraded: {
		colour: 'f0be11',
		emoji: ':yellow_square:',
		info: 'is suffering from degraded performance',
		title: 'Degraded Performance'
	},
	minor: {
		colour: 'fb923c',
		emoji: ':orange_square:',
		info: 'is offline', // don't actually use minor for individual status
		title: 'Minor Outage'
	},
	major: {
		colour: 'e25245',
		emoji: ':red_square:',
		info: 'is offline',
		title: 'Major Outage'
	}
};

exports.notiify = (fetch, overall, changed) => {
	const info = changed.map(s => `${statuses[s.status].emoji} \`${s.name}\` ${statuses[s.status].info}`).join('\n')
	return fetch(webhook, {
		body: JSON.stringify({
			content: `<@&${role}>`,
			embeds: [
				{
					description: `${info}\n\nView the status page at [status.left4craft.org](https://status.left4craft.org).`,
					color: parseInt(statuses[overall].colour, 16),
					author: {
						name: statuses[overall].title,
						url: 'https://status.left4craft.org',
						icon_url: `https://status.left4craft.org/icons/${overall}.png`
					}
				}
			],
			'username': statuses[overall].title,
			'avatar_url': `https://status.left4craft.org/icons/${overall}.png`
		}),
		headers: { 'content-type': 'application/json' },
		method: 'POST',
	});
};

// async function main() {
//     await notiify('degraded', [
//         {
//             name: 'Survival',
//             status: 'degraded'
//         }
//     ]);
    
//     await notiify('minor', [
//         {
//             name: 'Survival',
//             status: 'degraded'
//         },
//         {
//             name: 'Party Games',
//             status: 'major'
//         }
//     ]);
    
//     await notiify('online', [
//         {
//             name: 'Survival',
//             status: 'online'
//         },
//         {
//             name: 'Party Games',
//             status: 'online'
//         }
//     ]);
    
// }

// main();
