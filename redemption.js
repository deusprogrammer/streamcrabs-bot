const { PubSubClient } = require('twitch-pubsub-client');
const { ApiClient } = require('twitch');
const { StaticAuthProvider } = require('twitch-auth');

var Xhr = require('./xhr');

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

const sendEvent = async (queue, event, verbosity = "simple") => {
    queue.unshift({event, level: verbosity});
}

let startListener = async (messageQueue) => {
    // Setup pubsub listener
    const pubSubClient = new PubSubClient();
    await pubSubClient.registerUserListener(apiClient)
    console.log("* User registered");

    // Create pubsub listener
    pubSubClient.onRedemption(userId, async (message) => {
        console.log("* " + JSON.stringify(message, null, 5));
        console.log("* " + message.userName + " just redeemed " + message.rewardId);

        // Redemption switch
        switch (message.rewardId) {
            case commands.battleAvatarCreate:
                let user = await Xhr.getUser(message.userName);

                if (user) {
                    sendEvent(messageQueue, {
                        type: "INFO",
                        targets: ["chat"],
                        eventData: {
                            results: {
                                message: `@${message.userName} already has a battle avatar.`
                            }
                        }
                    });
                    return;
                }

                console.log("BATTLE AVATAR CREATED FOR " + message.userName);
                sendEvent(messageQueue, {
                    type: "INFO",
                    targets: ["chat"],
                    eventData: {
                        results: {
                            message: `@${message.userName} created their battle avatar.`
                        }
                    }
                });
                Xhr.createUser(message);
                break;
            case commands.battleAPCharge1:
                console.log("AP + 5 FOR " + message.userName);
                sendEvent(messageQueue, {
                    type: "INFO",
                    targets: ["chat"],
                    eventData: {
                        results: {
                            message: `@${message.userName} charged 5 AP.`
                        }
                    }
                });
                Xhr.chargeAP(message, 5);
                break;
            case commands.battleAPCharge10:
                console.log("AP + 50 FOR " + message.userName);
                sendEvent(messageQueue, {
                    type: "INFO",
                    targets: ["chat"],
                    eventData: {
                        results: {
                            message: `@${message.userName} charged 50 AP.`
                        }
                    }
                });
                Xhr.chargeAP(message, 50);
                break;
            case commands.battleAPCharge100:
                console.log("AP + 100 FOR " + message.userName);
                sendEvent(messageQueue, {
                    type: "INFO",
                    targets: ["chat"],
                    eventData: {
                        results: {
                            message: `@${message.userName} charged 100 AP.`
                        }
                    }
                });
                Xhr.chargeAP(message, 100);
                break;
            case commands.battleAvatarRevive:
                console.log("REVIVE REQUESTED FOR " + message.userName);
                sendEvent(messageQueue, {
                    type: "INFO",
                    targets: ["chat"],
                    eventData: {
                        results: {
                            message: `@${message.userName} revived.`
                        }
                    }
                });
                Xhr.reviveAvatar(message);
                break;
        }
    });
}

module.exports = {
    startListener
}