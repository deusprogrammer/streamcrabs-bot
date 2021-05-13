const EventQueue = require('../components/base/eventQueue');
const Xhr = require('../components/base/xhr');

const TWITCH_EXT_CHANNEL_ID = process.env.TWITCH_EXT_CHANNEL_ID;

exports.commands = {}
exports.init = async (botContext) => {}
exports.redemptionHook = async (message, rewardName) => {
    if (rewardName.toUpperCase() === "PLAY RANDOM SOUND") {
        let botConfig = await Xhr.getBotConfig(TWITCH_EXT_CHANNEL_ID);
        let enabledAudio = botConfig.audioPool.filter((element) => {
            return !element.url.startsWith("*");
        })
        let n = Math.floor((Math.random() * enabledAudio.length));
        let url = enabledAudio[n].url;

        EventQueue.sendEvent({
            type: "CUSTOM_RANDOM_SOUND",
            targets: ["panel"],
            eventData: {
                requester: message.userName,
                url,
                results: {}
            }
        });
    }  else if (rewardName.toUpperCase() === "RANDOM VIDEO") {
        let botConfig = await Xhr.getBotConfig(TWITCH_EXT_CHANNEL_ID);
        let enabledVideos = botConfig.videoPool.filter((element) => {
            return !element.url.startsWith("*");
        })
        let n = Math.floor((Math.random() * enabledVideos.length));
        let url = enabledVideos[n].url;

        EventQueue.sendEvent({
            type: "RANDOM_CUSTOM_VIDEO",
            targets: ["panel"],
            eventData: {
                requester: message.userName,
                url,
                results: {}
            }
        });
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