const EventQueue = require('../components/base/eventQueue');
const Xhr = require('../components/base/xhr');

const TWITCH_EXT_CHANNEL_ID = process.env.TWITCH_EXT_CHANNEL_ID;

let currentVideoId = null;

let redemptionTypeMap = {
    VIDEO: "MULTI",
    IMAGE: "MULTI",
    DYNAMIC: "MULTI",
    AUDIO: "SOUND_PLAYER"
};

const performAction = async (type, id, soundId, subPanel, message, botContext) => {
    if (type === "VIDEO") {
        let video;
        if (id === null) {
            let enabledVideo = botContext.botConfig.videoPool.filter((element) => {
                return element.enabled;
            });
            let n = Math.floor((Math.random() * enabledVideo.length));
            video = enabledVideo[n];
        } else {
            video = botContext.botConfig.videoPool.find(video => video._id === id);
        }

        let {url, volume, name, chromaKey} = video;

        if (!volume) {
            volume = 1.0;
        }

        EventQueue.sendEventToOverlays(type, {
            url,
            message,
            chromaKey,
            volume,
            subPanel
        });
    } else if (type === "AUDIO") {
        let audio;
        if (id === null) {
            let enabledAudio = botContext.botConfig.audioPool.filter((element) => {
                return element.enabled;
            });
            let n = Math.floor((Math.random() * enabledAudio.length));
            audio = enabledAudio[n];
        } else {
            audio = botContext.botConfig.audioPool.find(audio => audio._id === id);
        }

        let {url, volume, name} = audio;

        if (!volume) {
            volume = 1.0;
        }

        EventQueue.sendEventToOverlays(type, {
            url,
            message,
            volume
        });
    } else if (type === "IMAGE") {
        let image;
        if (id === null) {
            let enabledImage = botContext.botConfig.imagePool;
            let n = Math.floor((Math.random() * enabledImage.length));
            image = enabledImage[n];
        } else {
            image = botContext.botConfig.videoPool.find(video => video._id === id);
        }

        let audio;
        if (soundId === null) {
            let enabledAudio = botContext.botConfig.audioPool.filter((element) => {
                return element.enabled;
            });
            let n = Math.floor((Math.random() * enabledAudio.length));
            audio = enabledAudio[n];
        } else {
            audio = botContext.botConfig.audioPool.find(audio => audio._id === id);
        }

        let {url, name} = image;
        let {url: soundUrl, volume: soundVolume} = audio;

        if (!soundVolume) {
            soundVolume = 1.0;
        }

        EventQueue.sendEventToOverlays(type, {
            url,
            message,
            soundUrl,
            soundVolume,
            subPanel
        });

        return;
    }
}

let removeGold = async (username, amount) => {
    let user = await Xhr.getUser(username);

    if (!user.currencies[TWITCH_EXT_CHANNEL_ID] || user.currencies[TWITCH_EXT_CHANNEL_ID] < amount) {
        throw `${username} doesn't have ${amount} gold`;
    }

    await Xhr.giveGold({name: username}, -amount, TWITCH_EXT_CHANNEL_ID);
}

let speak = async ({text, username}) => {
    if (!text) {
        throw "Speak command must include message";
    }

    await removeGold(username, 50);
    EventQueue.sendInfoToChat(`${username} redeemed speak for 50g.`);

    EventQueue.sendEventToOverlays("TTS", {
        requester: username,
        text
    });
}

let playRandomVideo = async ({text, username}, botContext) => {
    await removeGold(username, 500);
    EventQueue.sendInfoToChat(`${username} redeemed a video for 500g.`);

    let id = null;
    if (text) {
        let found = botContext.botConfig.videoPool.filter((element) => {
            return element.name.toLowerCase() === text.toLowerCase();
        });

        if (found && found.length > 0) {
            id = found[0]._id;
        }
    }

    performAction("VIDEO", id, null, "default", null, botContext);
}

let playRandomSound = async ({text, username}, botContext) => {
    await removeGold(username, 100);
    EventQueue.sendInfoToChat(`${username} redeemed a sound for 100g`);

    let id = null;
    if (text) {
        let found = botContext.botConfig.audioPool.filter((element) => {
            return element.name.toLowerCase() === text.toLowerCase();
        });

        if (found && found.length > 0) {
            id = found[0]._id;
        }
    }

    performAction("AUDIO", id, null, "default", null, botContext);
}

const alert = async (message, alertType, {variable}, botContext) => {
    const {enabled, type, name, id, soundId, panel} = botContext.botConfig.alertConfigs[alertType];

    if (!enabled) {
        return;
    }

    if (type === "DYNAMIC") {
        let customTheme;
        let theme;
        if (id) {
            theme = "STORED";
            customTheme = await Xhr.getDynamicAlert(id);
        } else {
            theme = name;
        }
        
        EventQueue.sendEventToOverlays(type, {
            message,
            variable,
            theme,
            customTheme,
            subPanel: panel
        });
    } else {
        performAction(type, id, soundId, panel, message, botContext);
    }
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

        await playRandomVideo(twitchContext, botContext);
    },
    "!rewards:redeem:audio": async (twitchContext, botContext) => {
        if (!botContext.botConfig.config.rewards) {
            throw "This channel does not have this command enabled";
        }

        if (!EventQueue.isPanelInitialized("SOUND_PLAYER")) {
            EventQueue.sendInfoToChat("Sound panel is not available for this stream");
            return;
        }

        await playRandomSound(twitchContext, botContext);
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
    "!rewards:list": async () => {
        EventQueue.sendInfoToChat("The rewards are sound(100g), video(500g), speak(50g)");
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

        EventQueue.sendEventToOverlays("DUB", {
            results: {},
            videoData,
            substitution: null
        });
    }, 
    "!games:wtd:stop": async (twitchContext, botContext) => {
        // Check if mod
        if (twitchContext.username !== botContext.botConfig.twitchChannel && !twitchContext.mod) {
            throw "Only a mod can trigger What the Dub";
        }

        currentVideoId = null;
    }, 
    "!games:wtd:answer": async ({text, username}, botContext) => {
        if (!currentVideoId) {
            throw "There must be a current game running";
        }
        
        if (!text) {
            throw "Invalid syntax.";
        }

        let substitution = text;

        let videoData = await Xhr.getVideo(currentVideoId);
        let requester = username;

        EventQueue.sendEventToOverlays("DUB", {
            requester,
            videoData,
            substitution
        });
    },
    "!test:raid": (twitchContext, botContext) => {
        if (twitchContext.username !== botContext.botConfig.twitchChannel && !twitchContext.mod) {
            throw "Only a mod can test raid";
        }

        this.raidHook({username: "test_user", viewers: 100}, botContext);
    },
    "!test:sub": (twitchContext, botContext) => {
        if (twitchContext.username !== botContext.botConfig.twitchChannel && !twitchContext.mod) {
            throw "Only a mod can test subs";
        }

        this.subscriptionHook({userName: "test_user", subPlan: "tier 3"}, botContext);
    },
    "!test:follow": (twitchContext, botContext) => {
        if (twitchContext.username !== botContext.botConfig.twitchChannel && !twitchContext.mod) {
            throw "Only a mod can test follow";
        }

        this.followHook({userName: "test_user"}, botContext);
    },
    "!test:cheer": (twitchContext, botContext) => {
        if (twitchContext.username !== botContext.botConfig.twitchChannel && !twitchContext.mod) {
            throw "Only a mod can test cheer";
        }

        this.bitsHook({bits: 1000, userName: "test_user"}, botContext);
    }
}
exports.init = async (botContext) => {}

exports.followHook = async ({userName}, botContext) => {
    const {enabled, messageTemplate} = botContext.botConfig.alertConfigs.followAlert;
    const alertMessage = messageTemplate.replace("${username}", userName);

    if (!enabled) {
        return;
    }

    await alert(alertMessage, "followAlert", {variable: 1}, botContext);
}

exports.bitsHook = async ({bits, userName}, botContext) => {
    const {enabled, messageTemplate} = botContext.botConfig.alertConfigs.cheerAlert;
    const alertMessage = messageTemplate.replace("${bits}", bits).replace("${username}", userName);

    if (!enabled) {
        return;
    }

    await alert(alertMessage, "cheerAlert", {variable: bits}, botContext);
}

exports.subscriptionHook = async ({userName, subPlan}, botContext) => {
    const {enabled, messageTemplate} = botContext.botConfig.alertConfigs.subAlert;
    const alertMessage = messageTemplate.replace("${username}", userName).replace("${subTier}", subPlan);

    if (!enabled) {
        return;
    }

    await alert(alertMessage, "subAlert", {variable: 100}, botContext);
}

exports.raidHook = async ({username, viewers}, botContext) => {
    const {enabled, messageTemplate} = botContext.botConfig.alertConfigs.raidAlert;
    const alertMessage = messageTemplate.replace("${raider}", username).replace("${viewers}", viewers);

    if (!enabled) {
        return;
    }

    await alert(alertMessage, "raidAlert", {variable: viewers}, botContext);
}

exports.joinHook = async (joinContext, botContext) => {
}

exports.redemptionHook = async ({rewardId, rewardPrompt, id, rewardTitle, userName}, botContext) => {
    let botConfig = await Xhr.getBotConfig(TWITCH_EXT_CHANNEL_ID);

    // Perform commands found in prompt.
    let commandMatch = rewardPrompt.match(/\[(.*):(.*):(.*):(.*)\]/);
    if (commandMatch) {
        let [,type, subPanel, action, parameter] = commandMatch;

        switch (type) {
            case "GAUGE": {
                if (!botConfig.gauges[subPanel]) {
                    break;
                }

                let {label, currentValue, maxValue, increaseSound, decreaseSound, completeSound} = botConfig.gauges[subPanel];

                if (action === "ADD") {
                    currentValue += parseInt(parameter);
                } else if (action === "SUB") {
                    currentValue -= parseInt(parameter);
                } else if (action === "SET") {
                    currentValue = parseInt(parameter);
                }

                let {url: increaseSoundUrl} = botContext.botConfig.audioPool.find(audio => audio._id === increaseSound);
                let {url: decreaseSoundUrl} = botContext.botConfig.audioPool.find(audio => audio._id === decreaseSound);
                let {url: completeSoundUrl} = botContext.botConfig.audioPool.find(audio => audio._id === completeSound);

                EventQueue.sendEventToOverlays("GAUGE", {
                    label,
                    currentValue,
                    maxValue,
                    subPanel,
                    increaseSoundUrl,
                    decreaseSoundUrl,
                    completeSoundUrl,
                    init: false
                });
                botConfig.gauges[subPanel].currentValue = currentValue;

                Xhr.updateGauge(TWITCH_EXT_CHANNEL_ID, botConfig.gauges);
                break; 
            }
        default:
            break;
        }
    }

    // If there is a custom reward with this id, perform the associated action.
    let customReward = botConfig.redemptions[rewardId];
    if (customReward) {

        let {id: mediaId, soundId, type, subPanel} = customReward;
        if (!EventQueue.isPanelInitialized(redemptionTypeMap[type], subPanel)) {
            EventQueue.sendInfoToChat("Required panel is not available for this stream");
            await Xhr.refundRedemption(rewardId, id, botConfig);
            return;
        }
        performAction(type, mediaId, soundId, subPanel, null, botContext);
        await Xhr.clearRedemption(rewardId, id, botConfig);
        return;
    }

    if (rewardTitle.toUpperCase() === "RANDOM SOUND" || rewardTitle.toUpperCase() === "PLAY RANDOM SOUND") {
        if (!EventQueue.isPanelInitialized("SOUND_PLAYER")) {
            EventQueue.sendInfoToChat("Sound panel is not available for this stream");
            await Xhr.refundRedemption(rewardId, id, botConfig);
            return;
        }
        
        performAction("AUDIO", null, null, "default", null, botContext);

        await Xhr.clearRedemption(rewardId, id, botConfig);
    }  else if (rewardTitle.toUpperCase() === "RANDOM VIDEO" || rewardTitle.toUpperCase() === "PLAY RANDOM VIDEO") {
        if (!EventQueue.isPanelInitialized("MULTI")) {
            EventQueue.sendInfoToChat("Video panel is not available for this stream");
            await Xhr.refundRedemption(rewardId, id, botConfig);
            return;
        }

        performAction("VIDEO", null, null, "default", null, botContext);

        await Xhr.clearRedemption(rewardId, id, botConfig, botContext);
    } else if (rewardTitle.toUpperCase() === "BIRD UP") {
        if (!EventQueue.isPanelInitialized("MULTI")) {
            EventQueue.sendInfoToChat("Video panel is not available for this stream");
            await Xhr.refundRedemption(rewardId, id, botConfig);
            return;
        }

        EventQueue.sendEventToOverlays("BIRDUP", {subPanel: "default"});

        await Xhr.clearRedemption(rewardId, id, botConfig);
    } else if (rewardTitle.toUpperCase() === "BAD APPLE") {
        if (!EventQueue.isPanelInitialized("MULTI")) {
            EventQueue.sendInfoToChat("Video panel is not available for this stream");
            await Xhr.refundRedemption(rewardId, id, botConfig);
            return;
        }

        EventQueue.sendEventToOverlays("VIDEO", {
            url: "/util/twitch-tools/videos/badapple.mp4",
            chromaKey: "black",
            volume: "0.8",
            subPanel: "default"
        });

        await Xhr.clearRedemption(rewardId, id, botConfig);
    } else if (rewardTitle.toUpperCase() === "BE A BIG SHOT") {
        if (!EventQueue.isPanelInitialized("MULTI") || !EventQueue.isPanelInitialized("FILE_WRITER")) {
            EventQueue.sendInfoToChat("Video panel or filewriter proxy is not available for this stream");
            await Xhr.refundRedemption(rewardId, id, botConfig);
            return;
        }

        EventQueue.sendEventToOverlays("VIDEO", {
            message: `${userName} is a big shot for the week!`,
            url: "/util/twitch-tools/videos/bigshot.mp4",
            chromaKey: null,
            volume: "0.8",
            subPanel: "default"
        });

        EventQueue.sendEventToOverlays("FILE_WRITER", {
            textToWrite: userName,
            fileToWriteTo: "BIG_SHOT"
        });

        EventQueue.sendInfoToChat(`${userName} is now a BIG SHOT!`);

        await Xhr.clearRedemption(rewardId, id, botConfig);
    }
}

exports.wsInitHook = async ({subPanel}, botContext) => {
    let botConfig = await Xhr.getBotConfig(TWITCH_EXT_CHANNEL_ID);
    let gauge = botConfig.gauges[subPanel];

    if (!gauge) {
        return;
    }

    let {label, currentValue, maxValue, increaseSound, decreaseSound, completeSound} = gauge;

    let {url: increaseSoundUrl} = botContext.botConfig.audioPool.find(audio => audio._id === increaseSound);
    let {url: decreaseSoundUrl} = botContext.botConfig.audioPool.find(audio => audio._id === decreaseSound);
    let {url: completeSoundUrl} = botContext.botConfig.audioPool.find(audio => audio._id === completeSound);

    EventQueue.sendEventToOverlays("GAUGE", {
        label,
        currentValue,
        maxValue,
        subPanel,
        increaseSoundUrl,
        decreaseSoundUrl, 
        completeSoundUrl,
        init: true
    });
}