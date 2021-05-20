const axios = require('axios');
const EventQueue = require('../components/base/eventQueue');
const Xhr = require('../components/base/xhr');

const TWITCH_EXT_CHANNEL_ID = process.env.TWITCH_EXT_CHANNEL_ID;

let currentVideoId = null;

exports.commands = {
    "!games:wtd:start": async (twitchContext, botContext) => {
        // Check if mod
        if (twitchContext.username !== botContext.botConfig.twitchChannel && !twitchContext.mod) {
            throw "Only a mod can trigger What the Dub";
        }

        if (twitchContext.tokens.length < 1) {
            throw "You must provide a video id";
        }
        let videoId = twitchContext.tokens[1];
        currentVideoId = videoId;

        let videoData = await Xhr.getVideo(videoId);

        EventQueue.sendEvent({
            type: "DUB",
            targets: ["panel"],
            eventData: {
                results: {},
                videoData,
                substitution: null
            }
        });
    }, 
    "!games:wtd:stop": async (twitchContext, botContext) => {
        // Check if mod
        if (twitchContext.username !== botContext.botConfig.twitchChannel && !twitchContext.mod) {
            throw "Only a mod can trigger What the Dub";
        }

        currentVideoId = null;
    }, 
    "!games:wtd:answer": async (twitchContext, botContext) => {
        if (!currentVideoId) {
            throw "There must be a current game running";
        }
        
        let requestMatch = twitchContext.command.match(/!games:wtd:answer (.*)/);

        if (!requestMatch) {
            throw "Invalid syntax.";
        }

        let substitution = requestMatch[1];

        let videoData = await Xhr.getVideo(currentVideoId);

        EventQueue.sendEvent({
            type: "DUB",
            targets: ["panel"],
            eventData: {
                results: {},
                videoData,
                substitution
            }
        });
    }
}
exports.init = async (botContext) => {}
exports.redemptionHook = async (message, rewardName) => {
    if (rewardName.toUpperCase() === "PLAY RANDOM SOUND") {
        let botConfig = await Xhr.getBotConfig(TWITCH_EXT_CHANNEL_ID);
        let enabledAudio = botConfig.audioPool.filter((element) => {
            return !element.url.startsWith("*");
        })
        let n = Math.floor((Math.random() * enabledAudio.length));
        let url = enabledAudio[n].url;

        console.log("Sound index: " + n);
        console.log("Sound URL:   " + url);

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

        console.log("Video index: " + n);
        console.log("Video URL:   " + url);

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