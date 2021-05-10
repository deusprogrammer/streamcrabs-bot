const WebSocket = require('ws');
const jsonwebtoken = require('jsonwebtoken');

const Redemption = require('./redemption');
const Xhr = require('./xhr');
const Util = require('./util');

const TWITCH_EXT_CHANNEL_ID = process.env.TWITCH_EXT_CHANNEL_ID;

// Queue for messages to avoid flooding
let queue = [];

/* 
* CHAT BOT 
*/

const createExpirationDate = () => {
    var d = new Date();
    var year = d.getFullYear();
    var month = d.getMonth();
    var day = d.getDate();
    var c = new Date(year + 1, month, day);
    return c;
}

const createJwt = (secret) => {
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

// Setup websocket to communicate with extension
let extWs = null;
const connectWs = () => {
    extWs = new WebSocket('wss://deusprogrammer.com/api/ws/twitch');
 
    extWs.on('open', () => {
        console.log("OPENED WS");
        extWs.send(JSON.stringify({
            type: "REGISTER",
            channelId: TWITCH_EXT_CHANNEL_ID,
            jwt: createJwt(eventContext.botContext.botConfig.sharedSecretKey),
        }));

        extWs.send(JSON.stringify({
            type: "STARTUP",
            channelId: TWITCH_EXT_CHANNEL_ID,
            jwt: createJwt(eventContext.botContext.botConfig.sharedSecretKey),
            to: "ALL"
        }));

        // Keep connection alive
        pingInterval = setInterval(() => {
            extWs.send(JSON.stringify({
                type: "PING_SERVER",
                channelId: TWITCH_EXT_CHANNEL_ID,
                jwt: createJwt(eventContext.botContext.botConfig.sharedSecretKey),
            }));
        }, 20 * 1000);
    });

    extWs.on('message', async (message) => {
        let event = JSON.parse(message);

        // Ignore messages originating from bot
        if (["SERVER", `BOT-${TWITCH_EXT_CHANNEL_ID}`].includes(event.from)) {
            return;
        }

        console.log("EVENT: " + JSON.stringify(event, null, 5));

        // If it's just a panel listener requesting initialization, just do it marrrrrrk.
        if (event.type === "PANEL_INIT") {
            for (let plugin of eventContext.botContext.plugins) {
                plugin.wsInitHook();
            }

            return;
        }

        // Validate ws server signature
        let signature = event.signature;
        let actualSignature = Util.hmacSHA1(eventContext.botContext.botConfig.sharedSecretKey, event.to + event.from + event.ts);

        if (signature !== actualSignature) {
            console.error("Dropping message due to signature mismatch");
            console.error(`${signature} !== ${actualSignature}`);
            return;
        }

        // Handle message
        if (event.type === "COMMAND") {
            onMessageHandler(eventContext.botContext.botConfig.twitchChannel, {username: event.fromUser, "user-id": event.from, mod: false}, event.message, false);
            const caller = {
                id: event.from,
                name: event.fromUser
            }
            sendContextUpdate([caller]);
        } else if (event.type === "CONTEXT" && event.to !== "ALL") {
            console.log("CONTEXT REQUEST FROM " + event.from);
            let players = await Xhr.getActiveUsers(eventContext.botContext);
            extWs.send(JSON.stringify({
                type: "CONTEXT",
                channelId: TWITCH_EXT_CHANNEL_ID,
                jwt: createJwt(eventContext.botContext.botConfig.sharedSecretKey),
                to: event.from,
                data: {
                    players,
                    monsters: Object.keys(encounterTable).map(key => `~${key}`),
                    cooldown: cooldownTable[event.fromUser],
                    buffs: buffTable[event.fromUser]
                }
            }));
        } else if (event.type === "PING") {
            extWs.send(JSON.stringify({
                type: "PONG",
                channelId: TWITCH_EXT_CHANNEL_ID,
                jwt: createJwt(eventContext.botContext.botConfig.sharedSecretKey),
                to: event.from,
            }));
        }
    });

    extWs.on('close', (e) => {
        console.log('Socket is closed. Reconnect will be attempted in 5 second.', e.reason);
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
        }
        setTimeout(() => {
            connectWs(eventContext.botContext.botConfig);
        }, 5000);
    });

    extWs.on('error', (e) => {
        console.error('Socket encountered error: ', e.message, 'Closing socket');
        extWs.close();
    });
}

const sendContextUpdate = async (targets, data, shouldRefresh = false) => {
    if (targets) {
        targets.forEach((target) => {
            extWs.send(JSON.stringify({
                type: "CONTEXT",
                channelId: TWITCH_EXT_CHANNEL_ID,
                jwt: createJwt(eventContext.botContext.botConfig.sharedSecretKey),
                to: target.id,
                data
            }));
        });
    } else {
        extWs.send(JSON.stringify({
            type: "CONTEXT",
            channelId: TWITCH_EXT_CHANNEL_ID,
            jwt: createJwt(eventContext.botContext.botConfig.sharedSecretKey),
            to: "ALL",
            data
        }));
    }
}

const sendEventToPanels = async (event) => {
    event.channelId = TWITCH_EXT_CHANNEL_ID;
    event.to = "PANELS";
    event.jwt = createJwt(eventContext.botContext.botConfig.sharedSecretKey);
    extWs.send(JSON.stringify(event));
}

const sendEventToUser = async (user, event) => {
    event.channelId = TWITCH_EXT_CHANNEL_ID;
    event.to = user.id;
    event.jwt = createJwt(eventContext.botContext.botConfig.sharedSecretKey);
    extWs.send(JSON.stringify(event));
}

const sendEvent = async (event, verbosity = "simple") => {
    queue.unshift({event, level: verbosity});
}

const sendInfoToChat = async (message, includePanel = false) => {
    let targets = ["chat"]

    if (includePanel) {
        targets.push("panel");
    }

    sendEvent({
        type: "INFO",
        targets,
        eventData: {
            results: {
                message
            }
        }
    })
}

const sendErrorToChat = async(message) => {
    let targets = ["chat"]

    sendEvent({
        type: "INFO",
        targets,
        eventData: {
            results: {
                message
            }
        }
    })
}

let eventContext = {
    botContext: {}
}

// QUEUE CONSUMER
let startEventListener = async (botContext) => {
    eventContext.botContext = botContext;
    connectWs();
    await Redemption.startListener(queue, extWs, eventContext.botContext, botContext.plugins);
    setInterval(async () => {
        let message = queue.pop();

        if (message) {
            let event = message.event;
            let text = event.eventData ? event.eventData.results.message : "EXT MESSAGE";

            if (!event.targets) {
                event.targets = ["chat"];
            }

            if (typeof text === "object" && text.stack) {
                console.error("ERROR: " + text.message + ":\n" + text.stack);
                text = text.message;
            } else {
                console.log("TEXT: " + text);
            }

            if (message.level !== eventContext.botContext.configTable.verbosity && message.level !== "simple") {
                return;
            }

            // Send event to chat
            if (event.targets.includes("chat")) {
                if (text.startsWith("/")) {
                    eventContext.botContext.client.say(eventContext.botContext.botConfig.twitchChannel, text);
                } else {
                    eventContext.botContext.client.say(eventContext.botContext.botConfig.twitchChannel, "/me " + text);
                }
            }
            // Send event to panel via web socket
            if (event.targets.includes("panel")) {
                sendEventToPanels(event);
            }

            // Handle different events that pertain to the bot's personality
            // await mikuEventHandler(eventContext.botContext.client, event);
        }
    }, 500);
}

exports.sendEvent = sendEvent;
exports.sendEventToPanels = sendEventToPanels;
exports.sendEventToUser = sendEventToUser;
exports.sendContextUpdate = sendContextUpdate;
exports.sendInfoToChat = sendInfoToChat;
exports.sendErrorToChat = sendErrorToChat;
exports.startEventListener = startEventListener;