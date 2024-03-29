const Xhr = require('./components/base/xhr');
const EventQueue = require('./components/base/eventQueue');

const tmi = require('tmi.js');
const { StaticAuthProvider } = require('@twurple/auth');
const { PubSubClient, BasicPubSubClient } = require('@twurple/pubsub');

const cbdPlugin = require('./botPlugins/cbd');
const requestPlugin = require('./botPlugins/requests');
const deathCounterPlugin = require('./botPlugins/deathCounter');
const cameraObscuraPlugin = require('./botPlugins/cameraObscura');
const fileWriterPlugin = require('./botPlugins/fileWriter');
const modToolsPlugin = require('./botPlugins/modTools');

const TWITCH_EXT_CHANNEL_ID = process.env.TWITCH_EXT_CHANNEL_ID;

const versionNumber = "5.1b";
const plugins = [deathCounterPlugin, requestPlugin, cameraObscuraPlugin, cbdPlugin, fileWriterPlugin, modToolsPlugin];

/*
 * INDEXES
 */

let botConfig = {};
let client = {};
let devMode = process.argv.includes("--dev-mode");

// Various config values that can be changed on the fly
let configTable = {
    verbosity: "verbose",
    maxEncounters: 4
};

let cooldowns = {};
let units = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000
}

let processMessage = () => {};

const performCustomCommand = (command, {type, coolDown, target}, botContext) => {
    console.log("COOLDOWN LEFT: " + cooldowns[command] - Date.now());
    if (cooldowns[command] && cooldowns[command] - Date.now() <= 0) {
        console.log("COOLDOWN OVER");
        delete cooldowns[command];
    } else if (cooldowns[command] && cooldowns[command] - Date.now() > 0) {
        throw "Custom command '" + command + "' is on cooldown until " + new Date(cooldowns[command]);
    }

    let match = coolDown.match(/(\d+)(ms|s|m|h)/);
    if (!match) {
        throw "Custom command has invalid cooldown string";
    }

    console.log("COOLDOWN PARSED: " + match[1] + " " + match[2]);

    cooldowns[command] = Date.now() + parseInt(match[1]) * units[match[2]];

    console.log("COOLDOWN ENDS AT: " + cooldowns[command]);

    if (type === "VIDEO") {
        let {url, volume, name, chromaKey} = botContext.botConfig.videoPool.find(video => video._id === target);

        EventQueue.sendEventToOverlays(type, {
            message: null,
            mediaName: name,
            url,
            chromaKey,
            volume
        });
    } else if (type === "AUDIO") {
        let {url, volume, name} = botContext.botConfig.audioPool.find(audio => audio._id === target);

        EventQueue.sendEventToOverlays(type, {
            message: null,
            mediaName: name,
            url,
            volume
        });
    }
}

// Define configuration options for chat bot
const startBot = async () => {
    try {
        console.log("* Retrieving bot config");
        botConfig = await Xhr.getBotConfig(TWITCH_EXT_CHANNEL_ID);

        let {twitchChannel} = botConfig;
        let channelAccessToken = botConfig.accessToken;
        let botContext = {};
        let chattersActive = {};

        console.log("* Retrieved bot config");
        console.log("CONFIG: " + JSON.stringify(botConfig, null, 5));

        // Called every time a message comes in
        const onMessageHandler = async (target, context, msg) => {
            let commands = {};
            plugins.forEach((plugin) => {
                commands = {...commands, ...plugin.commands};
            });

            const caller = {
                id: context["user-id"],
                name: context.username
            }

            // Reset a players activity tick to a full 10 minutes before we check again
            if (chattersActive[context.username]) {
                chattersActive[context.username] = 10 * 12;
            }

            // Remove whitespace from chat message
            const command = msg.trim();
            const [commandName, ...text] = command.split(" ");
            const tokens = command.split(" ");

            const commandText = text.join(" ");

            // Handle battle commands here
            if (command.startsWith("!") || command.startsWith("$")) {
                context.command = command;
                context.commandName = commandName;
                context.text = commandText;
                context.tokens = tokens;
                context.caller = caller;
                context.target = target;

                console.log("Received command!")
                console.log("Tokens: " + tokens);
                console.log("Text:   " + commandText);

                try {
                    switch (commandName) {
                        case "!help":
                            EventQueue.sendInfoToChat(`To checkout your character and see how to play Chat Battler Dungeon go to https://deusprogrammer.com/cbd.`);
                            break;
                        case "!about":
                            EventQueue.sendInfoToChat(`Streamcrabs Bot version ${versionNumber} written by @thetruekingofspace`);
                            break;
                        default:
                            if (commands[commandName]) {
                                await commands[commandName](context, botContext);
                            } else if (botContext.botConfig.commands[commandName]) {
                                await performCustomCommand(commandName, botContext.botConfig.commands[commandName], botContext);
                            }
                    }
                } catch (e) {
                    console.error(e.message + ": " + e.stack);
                    EventQueue.sendErrorToChat(new Error(e));
                }
            }
        }

        // Called every time the bot connects to Twitch chat
        const onConnectedHandler = processMessage = async () => {
            if (devMode) {
                console.log("* RUNNING IN DEV MODE");
            }
            console.log("* Connected to Twitch chat");

            botContext = {configTable, chattersActive, botConfig, plugins, client};

            // Initialize all plugins
            for (let plugin of plugins) {
                await plugin.init(botContext);
            }

            // Start queue consumer
            await EventQueue.startEventListener(botContext);

            // Announce restart
            EventQueue.sendInfoToChat(`Streamcrabs Bot version ${versionNumber} is online.  All systems nominal.`);
        }
        
        const onRaid = async (channel, username, viewers) => {
            let raidContext = {channel, username, viewers};

            console.log("RAID DETECTED " + username + ":" + viewers);
        
            // Run raid function of each plugin
            for (let plugin of plugins) {
                if (plugin.raidHook) {
                    await plugin.raidHook(raidContext, botContext);
                }
            }
        }

        const onSubscription = async (subMessage) => {
            try {
                // Run through subscription plugin hooks
                for (let plugin of plugins) {
                    if (plugin.subscriptionHook) {
                        await plugin.subscriptionHook(subMessage, botContext);
                    }
                }
            } catch (error) {
                console.error("SUB FAILURE: " + error);
            }
        } 

        const onBits = async (bitsMessage) => {
            try {
                // Run through bit plugin hooks
                for (let plugin of plugins) {
                    if (plugin.bitsHook) {
                        await plugin.bitsHook(bitsMessage, botContext);
                    }
                }
            } catch (error) {
                console.error("BIT FAILURE: " + error);
            }
        }

        const onRedemption = async (redemptionMessage) => {
            try {
                // Run through redemption plugin hooks
                for (let plugin of plugins) {
                    if (plugin.redemptionHook) {
                        await plugin.redemptionHook(redemptionMessage, botContext);
                    }
                }
            } catch (error) {
                console.error("REDEMPTION FAILURE: " + error);
            }
        }

        // Create a client with our options
        const opts = {
            identity: {
                username: process.env.TWITCH_BOT_USER,
                password: process.env.TWITCH_BOT_PASS
            },
            channels: [
                twitchChannel
            ]
        };

        console.log("* Retrieved bot config");

        // Create a client with our options
        console.log("* Connecting to Twitch chat");
        client = new tmi.client(opts);
        client.on('message', onMessageHandler);
        client.on('connected', onConnectedHandler);
        client.on('raided', onRaid);
        await client.connect();

        // Attempt to connect to pubsub
        // console.log("* Attempting to connect to pubsub");
        // const authProvider = new RefreshingAuthProvider(
        //     {
        //         clientId: process.env.TWITCH_CLIENT_ID, 
        //         clientSecret: process.env.TWITCH_CLIENT_SECRET, 
        //         onRefresh: async newTokenData => {}
        //     },
        //     channelAccessToken
        // );
        // const authProvider = new StaticAuthProvider(
        //     process.env.TWITCH_CLIENT_ID, 
        //     channelAccessToken, 
        //     [
        //         "chat:read", 
        //         "chat:edit", 
        //         "channel:read:redemptions", 
        //         "channel:read:subscriptions", 
        //         "bits:read", 
        //         "channel_subscriptions"
        //     ]);
        // const basicClient = new BasicPubSubClient({
        //     wsOptions: {
        //         webSocket: false
        //     }
        // });
        // pubSubClient = new PubSubClient(basicClient);
        // const userId = await pubSubClient.registerUserListener(authProvider, twitchChannel);
        // await pubSubClient.onSubscription(userId, onSubscription);
        // await pubSubClient.onBits(userId, onBits);
        // await pubSubClient.onRedemption(userId, onRedemption);
        // console.log("* Connected to pubsub");
    } catch (error) {
        console.error(`* Failed to start bot: ${error}`);
    }
};

startBot();

exports.processMessage = processMessage;