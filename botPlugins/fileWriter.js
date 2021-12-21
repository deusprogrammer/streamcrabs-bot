const EventQueue = require('../components/base/eventQueue');

exports.commands = {
    "!cg": async ({text, username, mod}, botContext) => {
        if (username !== botContext.botConfig.twitchChannel && !mod) {
            throw "Only a mod can change current game";
        }

        if (!text) {
            throw "You must provide a game title with the change game command"
        }

        let textToWrite = text;
        EventQueue.sendEventToOverlays("FILE_WRITER", {
            textToWrite,
            fileToWriteTo: "CG"
        });
        EventQueue.sendInfoToChat(`Current game changed to ${textToWrite}`);
    }
}
exports.init = async (botContext) => {}
exports.bitsHook = async ({bits, userName, userId}, botContext) => {
    EventQueue.sendEventToOverlays("FILE_WRITER", {
        textToWrite: `${userName} (${bits} bits)`,
        fileToWriteTo: "LATEST_CHEER"
    });
}
exports.subscriptionHook = async ({userName}) => {
    EventQueue.sendEventToOverlays("FILE_WRITER", {
        textToWrite: userName,
        fileToWriteTo: "LATEST_SUB"
    });
}
exports.followHook = async ({userName}) => {
    EventQueue.sendEventToOverlays("FILE_WRITER", {
        textToWrite: userName,
        fileToWriteTo: "LATEST_FOLLOW"
    });
}
exports.redemptionHook = async ({rewardTitle, userName, userId}, botContext) => {
    if (rewardTitle.toUpperCase() === "BE A BIG SHOT") {
        EventQueue.sendEventToOverlays("FILE_WRITER", {
            textToWrite: userName,
            fileToWriteTo: "BIG_SHOT"
        });
        EventQueue.sendInfoToChat(`${userName} is now a BIG SHOT!`);
    }
}
exports.onWsMessage = async (event, ws, botContext) => {}
exports.wsInitHook = (from) => {}