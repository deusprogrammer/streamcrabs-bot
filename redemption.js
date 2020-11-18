const { PubSubClient } = require('twitch-pubsub-client');
const { ApiClient } = require('twitch');
const { StaticAuthProvider } = require('twitch-auth');
const jsonwebtoken = require('jsonwebtoken');

var Xhr = require('./xhr');

// TODO Move these into an async function so we can use await

const TWITCH_EXT_CHANNEL_ID = process.env.TWITCH_EXT_CHANNEL_ID;

/* 
 * REDEMPTION BOT
*/

const createExpirationDate = () => {
    var d = new Date();
    var year = d.getFullYear();
    var month = d.getMonth();
    var day = d.getDate();
    var c = new Date(year + 1, month, day);
    return c;
}

const createJwt = async (secret) => {
    return jsonwebtoken.sign({
        "exp": createExpirationDate().getTime(),
        "user_id": `BOT-${TWITCH_EXT_CHANNEL_ID}`,
        "role": "moderator",
        "channel_id": TWITCH_EXT_CHANNEL_ID,
        "pubsub_perms": {
            "send":[
                "broadcast"
            ]
        }
    }, secret);
}

const sendEvent = async (queue, event, verbosity = "simple") => {
    queue.unshift({event, level: verbosity});
}

const sendContextUpdate = async (ws, context, targets, shouldRefresh = false) => {
    let players = await Xhr.getActiveUsers(context);
    if (targets) {
        targets.forEach((target) => {
            ws.send(JSON.stringify({
                type: "CONTEXT",
                jwt: createJwt(context.botConfig.sharedSecretKey),
                to: target.id,
                data: {
                    players,
                    monsters: Object.keys(context.encounterTable).map(key => `~${key}`),
                    buffs: context.buffTable[target.name],
                    cooldown: context.cooldownTable[target.name],
                    shouldRefresh
                }
            }));
        });
    } else {
        ws.send(JSON.stringify({
            type: "CONTEXT",
            jwt: createJwt(context.botConfig.sharedSecretKey),
            to: "ALL",
            data: {
                players,
                monsters: Object.keys(context.encounterTable).map(key => `~${key}`),
                shouldRefresh
            }
        }));
    }
}

let startListener = async (messageQueue, ws, context) => {
    const clientId = process.env.TWITCH_BOT_CLIENT_ID;
    const accessToken = context.botConfig.accessToken;
    const userId = context.botConfig.twitchChannelId;
    const authProvider = new StaticAuthProvider(clientId, accessToken);
    const apiClient = new ApiClient({ authProvider });

    // Setup pubsub listener
    const pubSubClient = new PubSubClient();
    await pubSubClient.registerUserListener(apiClient);
    console.log("* User registered");

    // Create pubsub listener
    pubSubClient.onRedemption(userId, async (message) => {
        let rewardName = message._data.data.redemption.reward.title;

        // console.log("* " + JSON.stringify(message, null, 5));
        console.log("* " + message.userName + " just redeemed " + message._data.data.redemption.reward.title);

        if (rewardName.toUpperCase().startsWith("AP")) {
            let groups = rewardName.match(/AP\s*\+\s*([0-9]+)/);
            
            if (!groups && groups.length < 2) {
                sendEvent(messageQueue, {
                    type: "INFO",
                    targets: ["chat"],
                    eventData: {
                        results: {
                            message: `Invalid reward name ${rewardName}`
                        }
                    }
                });
                return;
            }

            let amount = groups[1];
            await Xhr.chargeAP(message, parseInt(amount));
            sendEvent(messageQueue, {
                type: "INFO",
                targets: ["chat"],
                eventData: {
                    results: {
                        message: `@${message.userName} charged ${amount} AP.`
                    }
                }
            });
        } else if (rewardName.toUpperCase().startsWith("REVIVE")) {
            await Xhr.reviveAvatar(message);

            sendEvent(messageQueue, {
                type: "INFO",
                targets: ["chat"],
                eventData: {
                    results: {
                        message: `@${message.userName} revived.`
                    }
                }
            });
        }

        sendContextUpdate(ws, context, null, true);
    });

    return pubSubClient;
}

module.exports = {
    startListener
}