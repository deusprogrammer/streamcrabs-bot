const EventQueue = require('../components/base/eventQueue');

let requestList = [];

exports.commands = {
    "!tools:request:queue": async ({username, mod, text}, botContext) => {
        if (!botContext.botConfig.config.requests) {
            throw "This channel does not have this command enabled";
        }

        // Check if mod
        if (username !== botContext.botConfig.twitchChannel && !mod) {
            throw "Only a mod can queue requests";
        }

        let requestMatch = text.match(/["|'|`](.*)["|'|`]\s*@(.*)/);

        if (!requestMatch) {
            throw "Invalid syntax.  Correct syntax is '!tools:request:queue \"GAME/SONG\" @username";
        }

        requestList.unshift({
            request: requestMatch[1],
            requester: requestMatch[2]
        });

        EventQueue.sendEventToOverlays("REQUEST", {
            results: {
                message: `${requestMatch[2]} has requested ${requestMatch[1]}`
            },
            requestList
        });
    },
    "!tools:request:next": async (twitchContext, botContext) => {
        if (!botContext.botConfig.config.requests) {
            throw "This channel does not have this command enabled";
        }

        // Check if mod
        if (twitchContext.username !== botContext.botConfig.twitchChannel && !twitchContext.mod) {
            throw "Only a mod can queue requests";
        }

        let entry = requestList.pop();

        EventQueue.sendEventToOverlays("REQUEST", {
            results: {
                message: `Now playing ${entry.request} requested by @${entry.requester}`
            },
            requestList
        });
    },
    "!tools:request:depth": async (twitchContext, botContext) => {
        if (!botContext.botConfig.config.requests) {
            throw "This channel does not have this command enabled";
        }
        
        // Check if mod
        if (twitchContext.username !== botContext.botConfig.twitchChannel && !twitchContext.mod) {
            throw "Only a mod can queue requests";
        }

        EventQueue.sendInfoToChat(`The request queue is ${requestList.length} elements deep`);
    }
}

exports.init = async () => {}
exports.bitsHook = async () => {}
exports.subscriptionHook = async () => {}
exports.redemptionHook = async () => {}
exports.wsInitHook = () => {
    console.log(JSON.stringify(requestList, null, 5));
    EventQueue.sendEvent({
        type: "REQUEST",
        targets: ["panel"],
        eventData: {
            results: {},
            requestList
        }
    });
}