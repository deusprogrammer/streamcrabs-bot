module.exports = {
    "!tools:death": async (twitchContext, gameContext, eventUtil) => {
        // Check if mod
        if (twitchContext.username !== gameContext.botConfig.twitchChannel && !twitchContext.mod) {
            throw "Only a mod can increment the death counter";
        }

        let count = -1;
        if (twitchContext.tokens.length > 1) {
            count = parseInt(twitchContext.tokens[1]);
        }

        eventUtil.sendEvent({
            type: "DEATH_COUNT",
            targets: ["panel"],
            eventData: {
                results: {},
                count
            }
        });
    }
}