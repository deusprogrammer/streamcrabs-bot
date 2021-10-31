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

let speak = async (twitchContext) => {
    let requestMatch = twitchContext.command.match(/!rewards:redeem:speak (.*)/);

    await removeGold(twitchContext.username, 50);
    EventQueue.sendInfoToChat(`${twitchContext.username} redeemed speak for 50g.`);

    EventQueue.sendEvent({
        type: "TTS",
        targets: ["panel"],
        eventData: {
            requester: twitchContext.username,
            text: requestMatch[1],
            results: {}
        }
    });
}

let playRandomVideo = async (twitchContext) => {
    let requestMatch = twitchContext.command.match(/!rewards:redeem:video (.*)/);
    let botConfig = await Xhr.getBotConfig(TWITCH_EXT_CHANNEL_ID);
    let enabledVideos = botConfig.videoPool.filter((element) => {
        return !element.url.startsWith("*");
    })
    let n = Math.floor((Math.random() * enabledVideos.length));
    let url = enabledVideos[n].url;
    let mediaName = enabledVideos[n].name;
    let chromaKey = enabledVideos[n].chromaKey;
    let volume = enabledVideos[n].volume;

    if (requestMatch) {
        let found = enabledVideos.filter((element) => {
            return element.name.toLowerCase() === requestMatch[1].toLowerCase();
        });

        if (found && found.length > 0) {
            url = found[0].url;
            mediaName = found[0].name;
            chromaKey = found[0].chromaKey;
            volume = found[0].volume;
        }
    }

    await removeGold(twitchContext.username, 500);
    EventQueue.sendInfoToChat(`${twitchContext.username} redeemed a video for 500g.`);

    if (!volume) {
        volume = 1.0;
    }

    EventQueue.sendEvent({
        type: "RANDOM_CUSTOM_VIDEO",
        targets: ["panel"],
        eventData: {
            requester: twitchContext.username,
            mediaName,
            url,
            chromaKey,
            volume,
            results: {}
        }
    });
}

let playRandomSound = async (twitchContext) => {
    let requestMatch = twitchContext.command.match(/!rewards:redeem:audio (.*)/);
    let botConfig = await Xhr.getBotConfig(TWITCH_EXT_CHANNEL_ID);
    let enabledAudio = botConfig.audioPool.filter((element) => {
        return !element.url.startsWith("*");
    })
    let n = Math.floor((Math.random() * enabledAudio.length));
    let url = enabledAudio[n].url;
    let mediaName = enabledAudio[n].name;
    let volume = enabledAudio[n].volume;

    if (requestMatch) {
        let found = enabledAudio.filter((element) => {
            return element.name.toLowerCase() === requestMatch[1].toLowerCase();
        });

        if (found && found.length > 0) {
            url = found[0].url;
            mediaName = found[0].name;
            volume = found[0].volume;
        }
    } 

    await removeGold(twitchContext.username, 100);
    EventQueue.sendInfoToChat(`${twitchContext.username} redeemed a sound for 100g`);

    if (!volume) {
        volume = 1.0;
    }

    EventQueue.sendEvent({
        type: "CUSTOM_RANDOM_SOUND",
        targets: ["panel"],
        eventData: {
            requester: twitchContext.username,
            mediaName,
            url,
            volume,
            results: {}
        }
    });
}

exports.commands = {
    "!rewards:redeem:video": async (twitchContext, botContext) => {
        if (!botContext.botConfig.config.rewards) {
            throw "This channel does not have this command enabled";
        }

        if (!EventQueue.isPanelInitialized("MULTI")) {
            EventQueue.sendInfoToChat("Video panel is not available for this stream");
            return;
        }

        await playRandomVideo(twitchContext);
    },
    "!rewards:redeem:audio": async (twitchContext, botContext) => {
        if (!botContext.botConfig.config.rewards) {
            throw "This channel does not have this command enabled";
        }

        if (!EventQueue.isPanelInitialized("SOUND_PLAYER")) {
            EventQueue.sendInfoToChat("Sound panel is not available for this stream");
            return;
        }

        await playRandomSound(twitchContext);
    },
    "!rewards:redeem:speak": async (twitchContext, botContext) => {
        if (!botContext.botConfig.config.rewards) {
            throw "This channel does not have this command enabled";
        }

        if (!EventQueue.isPanelInitialized("TTS")) {
            EventQueue.sendInfoToChat("TTS panel is not available for this stream");
            return;
        }

        await speak(twitchContext);
    },
    "!rewards:list": async (twitchContext, botContext) => {
        EventQueue.sendInfoToChat("The rewards are sound(100g), video(500g)");
    },
    "!rewards:give:gold": async (twitchContext, botContext) => {
        if (!botContext.botConfig.config.rewards) {
            throw "This channel does not have this command enabled";
        }

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
        if (!botContext.botConfig.config.rewards) {
            throw "This channel does not have this command enabled";
        }
        
        let user = await Xhr.getUser(twitchContext.username);

        if (!user) {
            throw `${twitchContext.username} does not has a battler yet.  Please create one with channel points or the "!cbd:create" command.`;
        }

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

        let videoData = await Xhr.getVideo(videoId);

        if (!videoData) {
            throw new Error("No video with that id is available");
        }

        currentVideoId = videoId;

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
        let requester = twitchContext.username;

        EventQueue.sendEvent({
            type: "DUB",
            targets: ["panel"],
            eventData: {
                results: {},
                requester,
                videoData,
                substitution
            }
        });
    }
}
exports.init = async (botContext) => {}
exports.bitsHook = async (bits, message, userName, userId) => {}
exports.subscriptionHook = async (gifter, gifterId, giftee, gifteeId, tier, monthsSubbed) => {}
exports.raidHook = async (raidContext, botContext) => {
    if (!botContext.botConfig.config.raid) {
        return;
    }
    
    EventQueue.sendEvent({
        type: "RAID",
        targets: ["panel"],
        eventData: {
            results: {},
            raidTheme: botContext.botConfig.raidTheme,
            raider: raidContext.username,
            raidSize: raidContext.viewers
        }
    });
}
exports.joinHook = async (joinContext, botContext) => {
    console.log("JOIN");
}
exports.redemptionHook = async (rewardName, userName, userId) => {
    if (rewardName.toUpperCase() === "PLAY RANDOM SOUND") {
        if (!EventQueue.isPanelInitialized("SOUND_PLAYER")) {
            EventQueue.sendInfoToChat("Sound panel is not available for this stream");
            return;
        }
        let botConfig = await Xhr.getBotConfig(TWITCH_EXT_CHANNEL_ID);
        let enabledAudio = botConfig.audioPool.filter((element) => {
            return !element.url.startsWith("*");
        })
        let n = Math.floor((Math.random() * enabledAudio.length));
        let url = enabledAudio[n].url;
        let mediaName = enabledAudio[n].name;
        let volume = enabledAudio[n].volume;

        if (!volume) {
            volume = 1.0;
        }

        EventQueue.sendEvent({
            type: "CUSTOM_RANDOM_SOUND",
            targets: ["panel"],
            eventData: {
                requester: userName,
                mediaName,
                url,
                volume,
                results: {}
            }
        });
    }  else if (rewardName.toUpperCase() === "RANDOM VIDEO") {
        if (!EventQueue.isPanelInitialized("MULTI")) {
            EventQueue.sendInfoToChat("Video panel is not available for this stream");
            return;
        }

        let botConfig = await Xhr.getBotConfig(TWITCH_EXT_CHANNEL_ID);
        let enabledVideos = botConfig.videoPool.filter((element) => {
            return !element.url.startsWith("*");
        })
        let n = Math.floor((Math.random() * enabledVideos.length));
        let url = enabledVideos[n].url;
        let mediaName = enabledVideos[n].name;
        let chromaKey = enabledVideos[n].chromaKey;
        let volume = enabledVideos[n].volume;

        if (!volume) {
            volume = 1.0;
        }

        EventQueue.sendEvent({
            type: "RANDOM_CUSTOM_VIDEO",
            targets: ["panel"],
            eventData: {
                requester: userName,
                mediaName,
                url,
                chromaKey,
                volume,
                results: {}
            }
        });
    } else if (rewardName.toUpperCase() === "BIRD UP") {
        if (!EventQueue.isPanelInitialized("MULTI")) {
            EventQueue.sendInfoToChat("Video panel is not available for this stream");
            return;
        }

        EventQueue.sendEvent({
            type: "BIRDUP",
            targets: ["panel"],
            eventData: {
                requester: userName,
                results: {}
            }
        });
    } else if (rewardName.toUpperCase() === "BAD APPLE") {
        if (!EventQueue.isPanelInitialized("MULTI")) {
            EventQueue.sendInfoToChat("Video panel is not available for this stream");
            return;
        }

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