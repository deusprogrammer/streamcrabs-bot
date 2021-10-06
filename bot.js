const tmi = require('tmi.js');
const WebSocket = require('ws');

const Xhr = require('./components/base/xhr');
const EventQueue = require('./components/base/eventQueue');

const readline = require('readline');

const cbdPlugin = require('./botPlugins/cbd');
const requestPlugin = require('./botPlugins/requests');
const deathCounterPlugin = require('./botPlugins/deathCounter');
const cameraObscuraPlugin = require('./botPlugins/cameraObscura');

const TWITCH_EXT_CHANNEL_ID = process.env.TWITCH_EXT_CHANNEL_ID;

const versionNumber = "2.7b";

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

// Chatters that are available for battle
let chattersActive = {};

let botContext = {};

// Define configuration options for chat bot
const startBot = async () => {
    try {
        console.log("* Retrieving bot config");
        botConfig = await Xhr.getBotConfig(TWITCH_EXT_CHANNEL_ID);
        const opts = {
            identity: {
                username: process.env.TWITCH_BOT_USER,
                password: process.env.TWITCH_BOT_PASS
            },
            channels: [
                botConfig.twitchChannel
            ]
        };

        if (devMode) {
            opts["connection"] = {
                secure: true,
		        server: 'irc.fdgt.dev'
            }
        }

        console.log("* Retrieved bot config");

        // Create a client with our options
        client = new tmi.client(opts);

        // Register our event handlers (defined below)
        client.on('message', onMessageHandler);
        client.on('connected', onConnectedHandler);
        client.on("raided", onRaid);
        client.on("join", onJoin);

        // Connect to Twitch:
        client.connect();
    } catch (error) {
        console.error(`* Failed to start bot: ${error}`);
    }
};
startBot();

let commands = {...cbdPlugin.commands, ...deathCounterPlugin.commands, ...requestPlugin.commands, ...cameraObscuraPlugin.commands};
let plugins = [cbdPlugin, deathCounterPlugin, requestPlugin, cameraObscuraPlugin];

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true
});

rl.on('line', onConsoleCommand);

async function onConsoleCommand(command) {
    client.say(botContext.botConfig.twitchChannel, command);
}

async function onRaid(channel, username, viewers) {
    console.log("RAID DETECTED: " + channel + ":" + username + ":" + viewers);
    let raidContext = {channel, username, viewers};

    // Run raid function of each plugin
    for (let plugin of plugins) {
        if (plugin.raidHook) {
            plugin.raidHook(raidContext, botContext);
        }
    }
}

async function onJoin(channel, username, self) {
    console.log("USER JOINED CHAT: " + channel + ":" + username);
    let joinedContext = {channel, username};

    // Run joined function of each plugin
    for (let plugin of plugins) {
        if (plugin.joinHook) {
            plugin.joinHook(joinedContext, botContext);
        }
    }
}

// Called every time a message comes in
async function onMessageHandler(target, context, msg, self) {
    if (self) { return; } // Ignore messages from the bot

    // Reset a players activity tick to a full 10 minutes before we check again
    if (chattersActive[context.username]) {
        chattersActive[context.username] = 10 * 12;
    }

    console.log("CONTEXT: " + JSON.stringify(context, null, 5));
    console.log("MSG:     " + msg);

    const caller = {
        id: context["user-id"],
        name: context.username
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
                case "!help":
                    EventQueue.sendInfoToChat(`Visit https://deusprogrammer.com/util/twitch to see how to use our in chat battle system.`);
                    break;
                case "!config":
                    if (context.username !== botConfig.twitchChannel && !context.mod) {
                        throw "Only a mod or broadcaster can change config values";
                    }

                    if (context.tokens.length < 3) {
                        throw "Must provide a config value and a value";
                    }

                    var configElement = context.tokens[1];
                    var configValue = context.tokens[2];

                    configTable[configElement] = configValue;

                    break;
                case "!about":
                    EventQueue.sendInfoToChat(`Chat battler dungeon version ${versionNumber} written by thetruekingofspace`);
                    break;
                default:
                    if (commands[context.tokens[0]]) {
                        await commands[context.tokens[0]](context, botContext);
                    }
            }
        } catch (e) {
            console.error(e.message + ": " + e.stack);
            EventQueue.sendErrorToChat(new Error(e));
        }
    }
}

// Called every time the bot connects to Twitch chat
async function onConnectedHandler(addr, port) {
    console.log(`* Connected to ${addr}:${port}`);
    if (devMode) {
        console.log("* RUNNING IN DEV MODE");
    }
    console.log("COMMANDS: ");
    for (let command in commands) {
        console.log(command);
    }

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

// MIKU'S HEART

// const flaggedUsers = {};

// const handleItemGive = async (item, giver, receiver) => {
//     if (item.name.startsWith("Miku's")) {
//         if (receiver.name !== "miku_the_space_bot") {
//             client.say(botConfig.twitchChannel, `WHY ARE YOU TRADING THOSE?!  My ${item.name.replace("Miku's", "").toLowerCase()} aren't Pokemon cards >_<!`);
//             flaggedUsers[receiver.name] = true;
//             flaggedUsers[giver.name] = true;
//         } else {
//             let username = giver.name;
//             let mikusThings = await gatherMikusThings(username);
//             if (mikusThings.length > 0) {
//                 client.say(botConfig.twitchChannel, `Oh, ${username}...you're giving these back?  Hmmmmm...are you sure you don't have something else of mine...like my ${mikusThings.map(name => name.replace("Miku's", "").toLowerCase())[0]}.`);
//             } else {
//                 client.say(botConfig.twitchChannel, `Oh, ${username}...you're giving these back?  Hmmmmm...I guess I forgive you...baka.`);
//                 flaggedUsers[giver.name] = false;
//             }
//         }
//     } else if (item.type === "gift" && item.slot === "miku") {
//         // Handle giving gifts to Miku
//         client.whisper(giver.name, `Thanks for the ${item.name}...I'll remember this in the future.`);

//         // TODO Create a luck table or something
//     } else if (item.type === "sealed") {
//         // Handle giving sealed item to Miku
//         let sealedItem = await Xhr.getSealedItem(item.sealedItemId);

//         if (sealedItem.owningChannel != TWITCH_EXT_CHANNEL_ID) {
//             client.whisper(giver.name, `This sealed box is meant for another channel...you shouldn't have been able to get this.  Please contact deusprogrammer@gmail.com to let them know you have found a bug.`);
//             return;
//         }
        
//         if (!sealedItem || sealedItem.claimed) {
//             client.whisper(giver.name, `Huh...this box is empty.  That's weird.  Reach out to the streamer for assistance.`);
//             return;
//         }
//         client.whisper(giver.name, `Congratulations!  You got a ${sealedItem.name}!  ${sealedItem.description}.  The code is: ${sealedItem.code}`);
//         sealedItem.claimed = true;
//         sealedItem.claimedBy = giver.name;
//         await Xhr.updateSealedItem(sealedItem);
//     }
// }

// const gatherMikusThings = async (username) => {
//     let user = await Commands.getTarget(username, gameContext);
//     let mikusItems = Object.keys(user.inventory).map(key => user.inventory[key].name).filter(itemName => itemName.startsWith("Miku's"));
//     let mikusEquip = Object.keys(user.equipment).map(key => user.equipment[key].name).filter(itemName => itemName.startsWith("Miku's"));
//     let mikusItemsAll = [...mikusItems, ...mikusEquip];
    
//     return mikusItemsAll;
// }
 
// const mikuEventHandler = async (client, event) => {
//     // If the user get's an item that belong's to Miku, have her react
//     if (event.type === "ITEM_GET" && event.eventData.results.item.name.startsWith("Miku's")) {
//         client.say(botConfig.twitchChannel, `W...wait!  Give back my ${event.eventData.results.item.name.replace("Miku's", "").toLowerCase()} >//<!`);
//         flaggedUsers[event.eventData.results.receiver.name] = true;
//     } else if (event.type === "ITEM_GIVE") {
//         handleItemGive(event.eventData.results.item, event.eventData.results.giver, event.eventData.results.receiver);
//     } else if (event.type === "ITEM_GIFT" && event.eventData.results.item.name.startsWith("Miku's")) {
//         client.say(botConfig.twitchChannel, `WHERE DID YOU GET THOSE?!  I don't think I'm missing my ${event.eventData.results.item.name.replace("Miku's", "").toLowerCase()}...OMFG...WHERE DID THEY GO O//O;?`);
//         flaggedUsers[event.eventData.results.receiver.name] = true;
//         flaggedUsers[event.eventData.results.giver.name] = true;
//     } else if (event.type === "JOIN") {
//         let username = event.eventData.results.attacker.name;
//         let mikusThings = await gatherMikusThings(username);
//         if (mikusThings.length > 0) {
//             client.say(botConfig.twitchChannel, `I see you still have my ${mikusThings.map(name => name.replace("Miku's", "").toLowerCase())[0]} and probably other things...hentai.`);
//             flaggedUsers[username] = true;
//         }
//     }
// }