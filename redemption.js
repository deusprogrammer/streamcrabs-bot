const { PubSubClient } = require('twitch-pubsub-client');
const { ApiClient } = require('twitch');
const { StaticAuthProvider } = require('twitch-auth');
const jsonwebtoken = require('jsonwebtoken');

var Xhr = require('./xhr');

const BOT_USER_ID = 591669672;
const TWITCH_EXT_CHANNEL_ID = process.env.TWITCH_EXT_CHANNEL_ID;

/* 
 * REDEMPTION BOT
*/

// Setup Twitch API Client
const clientId = process.env.TWITCH_PUBSUB_CLIENT_ID;
const accessToken = process.env.TWITCH_PUBSUB_ACCESS_TOKEN;
const userId = process.env.TWITCH_PUBSUB_CHANNEL_USER_ID;
const authProvider = new StaticAuthProvider(clientId, accessToken);
const apiClient = new ApiClient({ authProvider });

const commands = {
    battleAPCharge1: "d4bc34fb-c360-4655-863a-a3e310f17347",
    battleAPCharge10: "14b9e261-4d1a-4bfc-b55a-59913162ec73",
    battleAPCharge100: "0b2d8300-b0d8-4e30-a116-0f7d73fafc9a",
    battleAvatarCreate: "fb444b86-4e6c-4af8-ac75-518efb882e78",
    battleAvatarRevive: "84f19708-65f9-468e-9d0a-65ab9554014a"
}

const key = process.env.TWITCH_SHARED_SECRET;
const secret = Buffer.from(key, 'base64');

const createExpirationDate = () => {
    var d = new Date();
    var year = d.getFullYear();
    var month = d.getMonth();
    var day = d.getDate();
    var c = new Date(year + 1, month, day);
    return c;
}

const jwt = jsonwebtoken.sign({
    "exp": createExpirationDate().getTime(),
    "user_id": BOT_USER_ID,
    "role": "moderator",
    "channel_id": TWITCH_EXT_CHANNEL_ID,
    "pubsub_perms": {
        "send":[
            "broadcast"
        ]
    }
}, secret);

const sendEvent = async (queue, event, verbosity = "simple") => {
    queue.unshift({event, level: verbosity});
}

const sendContextUpdate = async (ws, context, targets, shouldRefresh = false) => {
    let players = await Xhr.getActiveUsers(context);
    if (targets) {
        targets.forEach((target) => {
            ws.send(JSON.stringify({
                type: "CONTEXT",
                jwt,
                to: target.id,
                from: BOT_USER_ID,
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
            jwt,
            to: "ALL",
            from: BOT_USER_ID,
            data: {
                players,
                monsters: Object.keys(context.encounterTable).map(key => `~${key}`),
                shouldRefresh
            }
        }));
    }
}

let startListener = async (messageQueue, ws, context) => {
    // Setup pubsub listener
    const pubSubClient = new PubSubClient();
    await pubSubClient.registerUserListener(apiClient)
    console.log("* User registered");

    // Create pubsub listener
    pubSubClient.onRedemption(userId, async (message) => {
        console.log("* " + JSON.stringify(message, null, 5));
        console.log("* " + message.userName + " just redeemed " + message.rewardId);

        // Redemption switch
        try {
            switch (message.rewardId) {
                case commands.battleAPCharge1:
                    console.log("AP + 5 FOR " + message.userName);

                    await Xhr.chargeAP(message, 5);

                    sendEvent(messageQueue, {
                        type: "INFO",
                        targets: ["chat"],
                        eventData: {
                            results: {
                                message: `@${message.userName} charged 5 AP.`
                            }
                        }
                    });
                    break;
                case commands.battleAPCharge10:
                    console.log("AP + 50 FOR " + message.userName);

                    await Xhr.chargeAP(message, 50);

                    sendEvent(messageQueue, {
                        type: "INFO",
                        targets: ["chat"],
                        eventData: {
                            results: {
                                message: `@${message.userName} charged 50 AP.`
                            }
                        }
                    });
                    break;
                case commands.battleAPCharge100:
                    console.log("AP + 100 FOR " + message.userName);

                    await Xhr.chargeAP(message, 100);
                    
                    sendEvent(messageQueue, {
                        type: "INFO",
                        targets: ["chat"],
                        eventData: {
                            results: {
                                message: `@${message.userName} charged 100 AP.`
                            }
                        }
                    });
                    break;
                case commands.battleAvatarRevive:
                    console.log("REVIVE REQUESTED FOR " + message.userName);

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
                    break;
            }
        } catch(e) {
            console.log(e.message + ": " + e.stack);
        }

        sendContextUpdate(ws, context, null, true);
    });

    return pubSubClient;
}

module.exports = {
    startListener
}