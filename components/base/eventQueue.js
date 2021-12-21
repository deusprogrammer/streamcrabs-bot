const WebSocket = require('ws');
const jsonwebtoken = require('jsonwebtoken');

const Xhr = require('./xhr');
const Util = require('./util');

const TWITCH_EXT_CHANNEL_ID = process.env.TWITCH_EXT_CHANNEL_ID;
const HOOK_WS_URL = process.env.HOOK_WS_URL;
const BOT_WS_URL = process.env.BOT_WS_URL;

// Queue for messages to avoid flooding
let queue = [];

// List of panels that have initialized
let panels = {};

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

const connectHookWs = (botContext) => {
    let hookWs = new WebSocket(HOOK_WS_URL);
    hookWs.on('open', () => {
        console.log("* Opened Hook ws");
        hookWs.send(JSON.stringify({
            type: "CONNECT",
            channelId: TWITCH_EXT_CHANNEL_ID,
            // listenTo: ["FOLLOW", "CHEER", "SUB", "REDEMPTION"]
            listenTo: ["FOLLOW"]
        }));

        hookWs.on('message', (message) => {
            const event = JSON.parse(message);

            if (event.type !== "PING") {
                console.log("HOOK EVENT: " + JSON.stringify(event, null, 5));
            }

            switch(event.type) {
                case "FOLLOW":
                    for (plugin of botContext.plugins) {
                        if (plugin.followHook) {
                            plugin.followHook(event, botContext);
                        }
                    }

                    break;
                // case "CHEER":
                //     for (plugin of botContext.plugins) {
                //         if (plugin.bitsHook) {
                //             plugin.bitsHook(event, botContext);
                //         }
                //     }

                //     break;
                // case "SUB":
                //     for (plugin of botContext.plugins) {
                //         if (plugin.subscriptionHook) {
                //             plugin.subscriptionHook(event, botContext);
                //         }
                //     }

                //     break;
                // case "REDEMPTION":
                //     for (plugin of botContext.plugins) {
                //         if (plugin.redemptionHook) {
                //             plugin.redemptionHook(event, botContext);
                //         }
                //     }

                //     break;
                case "PING":
                    hookWs.send(JSON.stringify({
                        type: "PONG",
                        channelId: TWITCH_EXT_CHANNEL_ID
                    }));
            }
        });
    })
}

// Setup websocket to communicate with extension
let extWs = null;
const connectWs = (botContext) => {
    extWs = new WebSocket(BOT_WS_URL);
 
    extWs.on('open', () => {
        console.log("* Opened Bot ws");
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

    extWs.on('message', (message) => {
        let event = JSON.parse(message);

        // Ignore messages originating from bot
        if (["SERVER", `BOT-${TWITCH_EXT_CHANNEL_ID}`].includes(event.from)) {
            return;
        }

        // If it's just a panel listener requesting initialization, just do it marrrrrrk.
        if (event.type === "PANEL_INIT") {
            for (let plugin of eventContext.botContext.plugins) {
                plugin.wsInitHook(event);
            }

            console.log("BOT EVENT: " + JSON.stringify(event, null, 5));

            // Add panel to list for enabling and disabling functionality
            panels[event.name] = Date.now();
            return;
        } else if (event.type === "PANEL_PING") {
            panels[event.name] = Date.now();
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
        if (event.type === "PING") {
            extWs.send(JSON.stringify({
                type: "PONG",
                channelId: TWITCH_EXT_CHANNEL_ID,
                jwt: createJwt(eventContext.botContext.botConfig.sharedSecretKey),
                to: event.from,
            }));
        }

        for (plugin of botContext.plugins) {
            if (plugin.onWsMessage) {
                plugin.onWsMessage(event, extWs, botContext);
            }
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

const sendEventToPanels = (event) => {
    event.channelId = TWITCH_EXT_CHANNEL_ID;
    event.to = "PANELS";
    event.jwt = createJwt(eventContext.botContext.botConfig.sharedSecretKey);
    extWs.send(JSON.stringify(event));
}

const sendEventToUser = (user, event) => {
    event.channelId = TWITCH_EXT_CHANNEL_ID;
    event.to = user.id;
    event.jwt = createJwt(eventContext.botContext.botConfig.sharedSecretKey);
    extWs.send(JSON.stringify(event));
}

const sendEventTo = (to, event) => {
    event.channelId = TWITCH_EXT_CHANNEL_ID;
    event.to = to;
    event.jwt = createJwt(eventContext.botContext.botConfig.sharedSecretKey);
    extWs.send(JSON.stringify(event));
}

const sendEvent = (event, verbosity = "simple") => {
    queue.unshift({event, level: verbosity});
}

const sendInfoToChat = (message, includePanel = false) => {
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

const sendEventToOverlays = (type, eventData) => {
    const targets = ["panel"]

    if (!eventData.results) {
        eventData.results = {};
    }

    sendEvent({
        type,
        targets,
        eventData
    })
}

const sendErrorToChat = (message) => {
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
let startEventListener = (botContext) => {
    eventContext.botContext = botContext;
    connectWs(botContext);
    connectHookWs(botContext);
    setInterval(() => {
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
        }
    }, 2500);
}

const isPanelInitialized = (panelName) => {
    return Date.now() - panels[panelName] <= 30000;
}

exports.sendEvent = sendEvent;
exports.sendEventToPanels = sendEventToPanels;
exports.sendEventToUser = sendEventToUser;
exports.sendEventTo = sendEventTo;
exports.sendInfoToChat = sendInfoToChat;
exports.sendErrorToChat = sendErrorToChat;
exports.startEventListener = startEventListener;
exports.isPanelInitialized = isPanelInitialized;
exports.createJwt = createJwt;
exports.sendEventToOverlays = sendEventToOverlays;