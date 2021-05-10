const EventQueue = require('../eventQueue');

exports.commands = {}
exports.init = async (botContext) => {}
exports.redemptionHook = async (message, rewardName) => {
    if (rewardName.toUpperCase() === "PLAY RANDOM SOUND") {
        EventQueue.sendEvent({
            type: "PLAY_SOUND",
            targets: ["panel"],
            eventData: {
                requester: message.userName,
                results: {}
            }
        })
    }  else if (rewardName.toUpperCase() === "RANDOM VIDEO") {
        EventQueue.sendEvent({
            type: "RANDOM_VIDEO",
            targets: ["panel"],
            eventData: {
                requester: message.userName,
                results: {}
            }
        })
    } else if (rewardName.toUpperCase() === "BIRD UP") {
        EventQueue.sendEvent({
            type: "BIRDUP",
            targets: ["panel"],
            eventData: {
                requester: message.userName,
                results: {}
            }
        })
    } else if (rewardName.toUpperCase() === "BAD APPLE") {
        EventQueue.sendEvent({
            type: "BADAPPLE",
            targets: ["panel"],
            eventData: {
                requester: message.userName,
                results: {}
            }
        })
    }
}

exports.wsInitHook = () => {}