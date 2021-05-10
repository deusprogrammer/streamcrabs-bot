module.exports = {
    "!tools:request:queue": async (twitchContext, gameContext, eventUtil) => {
        if (!gameContext.botConfig.config.requests) {
            throw "This channel does not have this command enabled";
        }

        // Check if mod
        if (twitchContext.username !== gameContext.botConfig.twitchChannel && !twitchContext.mod) {
            throw "Only a mod can queue requests";
        }

        let requestMatch = twitchContext.command.match(/!tools:request:queue ["|'|`](.*)["|'|`]\s*@(.*)/);

        if (!requestMatch) {
            throw "Invalid syntax.  Correct syntax is '!tools:request:queue \"GAME/SONG\" @username";
        }

        gameContext.requestList.unshift({
            request: requestMatch[1],
            requester: requestMatch[2]
        });

        eventUtil.sendEvent({
            type: "REQUEST",
            targets: ["chat", "panel"],
            eventData: {
                results: {
                    message: `${requestMatch[2]} has requested ${requestMatch[1]}`
                },
                requestList: gameContext.requestList
            }
        });
    },
    "!tools:request:next": async (twitchContext, gameContext, eventUtil) => {
        if (!gameContext.botConfig.config.requests) {
            throw "This channel does not have this command enabled";
        }

        // Check if mod
        if (twitchContext.username !== gameContext.botConfig.twitchChannel && !twitchContext.mod) {
            throw "Only a mod can queue requests";
        }

        let entry = gameContext.requestList.pop();

        eventUtil.sendEvent({
            type: "REQUEST",
            targets: ["chat", "panel"],
            eventData: {
                results: {
                    message: `Now playing ${entry.request} requested by @${entry.requester}`
                },
                requestList: gameContext.requestList
            }
        });
    },
    "!tools:request:depth": async (twitchContext, gameContext, eventUtil) => {
        if (!gameContext.botConfig.config.requests) {
            throw "This channel does not have this command enabled";
        }
        
        // Check if mod
        if (twitchContext.username !== gameContext.botConfig.twitchChannel && !twitchContext.mod) {
            throw "Only a mod can queue requests";
        }

        eventUtil.sendInfoToChat(`The request queue is ${gameContext.requestList.length} elements deep`);
    }
}