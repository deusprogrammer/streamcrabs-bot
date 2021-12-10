const Xhr = require('./components/base/xhr');
const EventQueue = require('./components/base/eventQueue');

const { StaticAuthProvider } = require('@twurple/auth');
const { ChatClient } = require('@twurple/chat');
const { PubSubClient } = require('@twurple/pubsub');

const dns = require('dns');

const cbdPlugin = require('./botPlugins/cbd');
const requestPlugin = require('./botPlugins/requests');
const deathCounterPlugin = require('./botPlugins/deathCounter');
const cameraObscuraPlugin = require('./botPlugins/cameraObscura');

const TWITCH_EXT_CHANNEL_ID = process.env.TWITCH_EXT_CHANNEL_ID;

const versionNumber = "4.0b";

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

        EventQueue.sendEvent({
            type,
            targets: ["panel"],
            eventData: {
                message: [''],
                mediaName: name,
                url,
                chromaKey,
                volume,
                results: {}
            }
        });
    } else if (type === "AUDIO") {
        let {url, volume, name} = botContext.botConfig.audioPool.find(audio => audio._id === target);

        EventQueue.sendEvent({
            type,
            targets: ["panel"],
            eventData: {
                message: [''],
                mediaName: name,
                url,
                volume,
                results: {}
            }
        });
    }
}

// Define configuration options for chat bot
const startBot = async () => {
    try {
        console.log("* Retrieving bot config");
        botConfig = await Xhr.getBotConfig(TWITCH_EXT_CHANNEL_ID);

        let {twitchChannel, botUser} = botConfig;
        let channelAccessToken = botConfig.accessToken;
        let {twitchUser, accessToken, refreshToken} = botUser;
        let botContext = {};
        let chattersActive = {};

        let plugins = [deathCounterPlugin, requestPlugin, cameraObscuraPlugin, cbdPlugin];

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

            // Handle battle commands here
            if (command.startsWith("!")) {
                context.command = command;
                context.tokens = command.split(" ");
                context.caller = caller;
                context.target = target;

                console.log("Received command!")
                console.log("Tokens: " + context.tokens);

                try {
                    switch (context.tokens[0]) {
                        case "!about":
                            EventQueue.sendInfoToChat(`Chat battler dungeon version ${versionNumber} written by thetruekingofspace`);
                            break;
                        default:
                            if (commands[context.tokens[0]]) {
                                await commands[context.tokens[0]](context, botContext);
                            } else if (botContext.botConfig.commands[context.tokens[0]]) {
                                await performCustomCommand(context.tokens[0], botContext.botConfig.commands[context.tokens[0]], botContext);
                            }
                    }
                } catch (e) {
                    console.error(e.message + ": " + e.stack);
                    EventQueue.sendErrorToChat(new Error(e));
                }
            }
        }

        // Called every time the bot connects to Twitch chat
        const onConnectedHandler = async () => {
            if (devMode) {
                console.log("* RUNNING IN DEV MODE");
            }
            console.log("* Connected to Twitch chat");

            botContext = {configTable, chattersActive, botConfig, plugins, client};

            // Initialize all plugins
            for (let plugin of plugins) {
                plugin.init(botContext);
            }

            // Start queue consumer
            await EventQueue.startEventListener(botContext);

            // Announce restart
            EventQueue.sendInfoToChat(`Twitch Dungeon version ${versionNumber} is online.  All systems nominal.`);
        }
        
        const onRaid = async (channel, username, viewers) => {
            let raidContext = {channel, username, viewers};
        
            // Run raid function of each plugin
            for (let plugin of plugins) {
                if (plugin.raidHook) {
                    plugin.raidHook(raidContext, botContext);
                }
            }
        }

        const onSubscription = async (subMessage) => {
            try {
                // Run through subscription plugin hooks
                for (let plugin of plugins) {
                    if (plugin.subscriptionHook) {
                        plugin.subscriptionHook(subMessage, botContext);
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
                        plugin.bitsHook(bitsMessage, botContext);
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
                        plugin.redemptionHook(redemptionMessage, botContext);
                    }
                }
            } catch (error) {
                console.error("REDEMPTION FAILURE: " + error);
            }
        }

        console.log("CLIENT ID:      " + process.env.TWITCH_CLIENT_ID);
        console.log("BOT USER:       " + twitchUser);
        console.log("TWITCH CHANNEL: " + twitchChannel);
        console.log("ACCESS TOKEN:   " + accessToken);
        console.log("CHANNEL TOKEN:  " + channelAccessToken);

        // Create a client with our options
        const authProvider = new StaticAuthProvider(process.env.TWITCH_CLIENT_ID, accessToken, ["chat:read", "chat:edit", "channel:read:redemptions", "channel:read:subscriptions", "bits:read", "channel_subscriptions"], "user");
        client = new ChatClient({authProvider, channels: [twitchChannel]});

        const pubSubAuthProvider = new StaticAuthProvider(process.env.TWITCH_CLIENT_ID, channelAccessToken, ["chat:read", "chat:edit", "channel:read:redemptions", "channel:read:subscriptions", "bits:read", "channel_subscriptions"], "user");
        pubSubClient = new PubSubClient();
        const userId = await pubSubClient.registerUserListener(pubSubAuthProvider);

        // Register our event handlers (defined below)
        client.onMessage((channel, username, message) => {
            onMessageHandler(channel, {username, id: ""}, message);
        });
        client.onConnect(onConnectedHandler);
        client.onRaid((channel, username, {viewerCount}) => {onRaid(channel, username, viewerCount)});
        await pubSubClient.onSubscription(userId, onSubscription);
        await pubSubClient.onBits(userId, onBits);
        await pubSubClient.onRedemption(userId, onRedemption);

        console.log("* Connecting to Twitch chat");
        await client.connect();
    } catch (error) {
        console.error(`* Failed to start bot: ${error}`);
    }
};

startBot();