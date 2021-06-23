const EventQueue = require('../components/base/eventQueue');
const Xhr = require('../components/base/xhr');

const TWITCH_EXT_CHANNEL_ID = process.env.TWITCH_EXT_CHANNEL_ID;

let currentVideoId = null;

let removeGold = async (username, amount) => {
    let user = await Xhr.getUser(username);

    if (!user) {
        throw `${username} doesn't have a battler.  Please donate any number of bits to create one or use the channel point reward "Create Battler" if this channel supports it.`
    }

    if (!user.currencies || !user.currencies[TWITCH_EXT_CHANNEL_ID] || user.currencies[TWITCH_EXT_CHANNEL_ID] < amount) {
        throw `You don't have enough gold.  This redemption is worth ${amount}g.  Use !rewards:gold to check your gold.`;
    }
    user.currencies[TWITCH_EXT_CHANNEL_ID] -= amount;

    await Xhr.updateUser(user);
}

let playRandomVideo = async (twitchContext, botContext) => {
    await removeGold(twitchContext.username, 500);

    let botConfig = await Xhr.getBotConfig(TWITCH_EXT_CHANNEL_ID);
    let enabledVideos = botConfig.videoPool.filter((element) => {
        return !element.url.startsWith("*");
    })
    let n = Math.floor((Math.random() * enabledVideos.length));
    let url = enabledVideos[n].url;
    let chromaKey = enabledVideos[n].chromaKey;

    EventQueue.sendInfoToChat(`${twitchContext.username} redeemed a random video for 500g.`);

    EventQueue.sendEvent({
        type: "RANDOM_CUSTOM_VIDEO",
        targets: ["panel"],
        eventData: {
            requester: twitchContext.username,
            url,
            chromaKey,
            results: {}
        }
    });
}

let playRandomSound = async (twitchContext, botContext) => {
    await removeGold(twitchContext.username, 100);

    let botConfig = await Xhr.getBotConfig(TWITCH_EXT_CHANNEL_ID);
    let enabledAudio = botConfig.audioPool.filter((element) => {
        return !element.url.startsWith("*");
    })
    let n = Math.floor((Math.random() * enabledAudio.length));
    let url = enabledAudio[n].url;

    EventQueue.sendInfoToChat(`${twitchContext.username} redeemed a random sound for 100g`);

    EventQueue.sendEvent({
        type: "CUSTOM_RANDOM_SOUND",
        targets: ["panel"],
        eventData: {
            requester: twitchContext.username,
            url,
            results: {}
        }
    });
}

let playBirdUp = async (twitchContext, botContext) => {
    await removeGold(twitchContext.username, 200);

    EventQueue.sendInfoToChat(`${twitchContext.username} redeemed bird up for 200g`);

    EventQueue.sendEvent({
        type: "BIRDUP",
        targets: ["panel"],
        eventData: {
            requester: twitchContext.username,
            results: {}
        }
    });
}

let playBadApple = async (twitchContext, botContext) => {
    await removeGold(twitchContext.username, 1000);

    EventQueue.sendInfoToChat(`${twitchContext.username} redeemed bad apple for 1000g`);

    EventQueue.sendEvent({
        type: "BADAPPLE",
        targets: ["panel"],
        eventData: {
            requester: twitchContext.username,
            results: {}
        }
    });
}

exports.commands = {
    "!rewards:redeem:video": async (twitchContext, botContext) => {
        await playRandomVideo(twitchContext, botContext);
    },
    "!rewards:redeem:audio": async (twitchContext, botContext) => {
        await playRandomSound(twitchContext, botContext);
    },
    // "!rewards:redeem:birdup": async (twitchContext, botContext) => {
    //     await playBirdUp(twitchContext, botContext);
    // },
    // "!rewards:redeem:badapple": async (twitchContext, botContext) => {
    //     await playBadApple(twitchContext, botContext)
    // },
    "!rewards:list": async (twitchContext, botContext) => {
        EventQueue.sendInfoToChat("The rewards are sound(100g), video(500g)");
    },
    "!rewards:give": async (twitchContext, botContext) => {
        // Check if mod
        if (twitchContext.username !== botContext.botConfig.twitchChannel && !twitchContext.mod) {
            throw "Only a mod can give currency";
        }

        if (twitchContext.tokens.length < 3) {
            throw "You must provide an amount of gold";
        }

        let amount = parseInt(twitchContext.tokens[1]);
        let targetUser = twitchContext.tokens[2].replace("@", "").toLowerCase();

        let user = await Xhr.getUser(targetUser);

        if (!user) {
            throw `Cannot give gold to ${targetUser}, they do not has a battler yet.`;
        }

        await Xhr.addCurrency(user, amount);

        EventQueue.sendInfoToChat(`A mod just gifted ${amount}g to ${targetUser}`);
    },
    "!rewards:gold": async (twitchContext, botContext) => {
        let user = await Xhr.getUser(twitchContext.username);
        EventQueue.sendInfoToChat(`${twitchContext.username} has ${user.currencies[TWITCH_EXT_CHANNEL_ID] ? user.currencies[TWITCH_EXT_CHANNEL_ID] : 0}g`);
    },
    "!games:wtd:start": async (twitchContext, botContext) => {
        // Check if mod
        if (twitchContext.username !== botContext.botConfig.twitchChannel && !twitchContext.mod) {
            throw "Only a mod can trigger What the Dub";
        }

        if (twitchContext.tokens.length < 2) {
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
exports.bitsHook = async (bits, message, userName, userId) => {}
exports.subscriptionHook = async (gifter, gifterId, giftee, gifteeId, tier, monthsSubbed) => {}
exports.redemptionHook = async (rewardName, userName, userId) => {
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
                requester: userName,
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
        let chromaKey = enabledVideos[n].chromaKey;

        EventQueue.sendEvent({
            type: "RANDOM_CUSTOM_VIDEO",
            targets: ["panel"],
            eventData: {
                requester: userName,
                url,
                chromaKey,
                results: {}
            }
        });
    } else if (rewardName.toUpperCase() === "BIRD UP") {
        EventQueue.sendEvent({
            type: "BIRDUP",
            targets: ["panel"],
            eventData: {
                requester: userName,
                results: {}
            }
        });
    } else if (rewardName.toUpperCase() === "BAD APPLE") {
        EventQueue.sendEvent({
            type: "BADAPPLE",
            targets: ["panel"],
            eventData: {
                requester: userName,
                results: {}
            }
        });
    }
}

exports.wsInitHook = () => {}