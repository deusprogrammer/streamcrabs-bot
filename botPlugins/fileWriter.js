const EventQueue = require('../components/base/eventQueue');

exports.commands = {
    "!cg": async ({text}) => {
        if (!text) {
            throw "You must provide a game title with the change game command"
        }

        let textToWrite = text;
        EventQueue.sendEventToOverlay("FILE_WRITER", {
            textToWrite,
            fileToWriteTo: "CG"
        });
    }
}
exports.init = async (botContext) => {}
exports.bitsHook = async ({bits, userName, userId}, botContext) => {
    EventQueue.sendEventToOverlay("FILE_WRITER", {
        textToWrite: `${userName} (${bits} bits)`,
        fileToWriteTo: "LAST_CHEER"
    });
}
exports.subscriptionHook = async ({userName}) => {
    EventQueue.sendEventToOverlay("FILE_WRITER", {
        textToWrite: userName,
        fileToWriteTo: "LATEST_SUB"
    });
}
exports.followHook = async ({userName}) => {
    EventQueue.sendEventToOverlay("FILE_WRITER", {
        textToWrite: userName,
        fileToWriteTo: "LATEST_FOLLOW"
    });
}
exports.redemptionHook = async ({rewardTitle, userName, userId}, botContext) => {
    if (rewardTitle === "BE A BIG SHOT") {
        EventQueue.sendEventToOverlay("FILE_WRITER", {
            textToWrite: userName,
            fileToWriteTo: "BIG_SHOT"
        });
    }
}
exports.onWsMessage = async (event, ws, botContext) => {}
exports.wsInitHook = (from) => {}