const tmi = require('tmi.js');
const WebSocket = require('ws');

const Util = require('./util');
const Xhr = require('./xhr');
const Commands = require('./commands');
const Redemption = require('./redemption');

const BROADCASTER_NAME = "thetruekingofspace";

/*
 * INDEXES
 */

// Tables for caches of game data
let itemTable = {};
let jobTable = {};
let abilityTable = {};
let encounterTable = {};
let cooldownTable = {};

// Various config values that can be changed on the fly
let configTable = {
    verbosity: "verbose",
    maxEncounters: 4
};

// Chatters that are available for battle
let chattersActive = {};

// Combined game context of all of the above tables
let gameContext = {};

// Queue for messages to avoid flooding
let queue = [];

/* 
* CHAT BOT 
*/

// Setup websocket server for communicating with the panel
const wss = new WebSocket.Server({ port: 8090 });

wss.on('connection', function connection(ws) {
    let initEvent = {
        type: "INIT",
        eventData: {
            results: {},
            encounterTable
        }
    }
    ws.send(JSON.stringify(initEvent, null, 5));
});

const sendEventToPanels = async (event) => {
    wss.clients.forEach(function each(client) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(event));
        }
    });
}

// Define configuration options for chat bot
const opts = {
    identity: {
        username: "miku_the_space_bot",
        password: "oauth:k4gkyf9djs2atzzb4yr0zzrglc5hg2"
    },
    channels: [
        "thetruekingofspace"
    ]
};

// Create a client with our options
const client = new tmi.client(opts);

// Register our event handlers (defined below)
client.on('message', onMessageHandler);
client.on('connected', onConnectedHandler);

// Connect to Twitch:
client.connect();

// Called every time a message comes in
async function onMessageHandler(target, context, msg, self) {
    if (self) { return; } // Ignore messages from the bot

    // Reset a players activity tick to a full 10 minutes before we check again
    if (chattersActive[context.username]) {
        chattersActive[context.username] = 10 * 12;
    }

    // Remove whitespace from chat message
    const command = msg.trim();

    // Handle battle commands here
    if (command.startsWith("!")) {
        var tokens = command.split(" ");

        console.log("Received command!")
        console.log("Tokens: " + tokens);

        try {
            switch (tokens[0]) {
                case "!ready":
                    if (!chattersActive[context.username]) {
                        chattersActive[context.username] = 10 * 12;
                        queue.unshift({ target, text: `${context.username} is ready to battle!`, level: "simple" });
                        sendEventToPanels({
                            type: "JOIN",
                            eventData: {
                                results: {
                                    attacker: {
                                        name: context.username
                                    },
                                    message: `${context.username} joins the brawl!`
                                },
                                encounterTable
                            }
                        });
                    }
                    break;
                case "!attack":
                    if (tokens.length < 2) {
                        throw "You must have a target for your attack.";
                    }

                    var defenderName = tokens[1].replace("@", "").toUpperCase();

                    if (cooldownTable[context.username]) {
                        throw `${context.username} is on cooldown.`;
                    }

                    var results = await Commands.attack(context.username, defenderName, gameContext);

                    // Set user cool down
                    cooldownTable[context.username] = results.attacker.actionCooldown;

                    // Set user active if they attack
                    if (!chattersActive[context.username]) {
                        chattersActive[context.username] = 10 * 12;
                        queue.unshift({ target, text: `${context.username} comes out of the shadows and unsheathes his ${results.attacker.equipment.hand.name}!`, level: "verbose" });
                    }

                    // Announce results of attack
                    queue.unshift({ target, text: `${results.message}`, level: "verbose" });
                    sendEventToPanels({
                        type: "ATTACKED",
                        eventData: {
                            results: {
                                attacker: results.attacker,
                                defender: results.defender,
                                message: `${results.attacker.name} hit ${results.defender.name} for ${results.damage} damage.`
                            },
                            encounterTable
                        }
                    });

                    // Monster has died, remove from encounter table and reward the person who killed it.
                    if (results.defender.hp <= 0 && defenderName.startsWith("~")) {
                        //delete encounterTable[results.defender.encounterTableKey];

                        sendEventToPanels({
                            type: "DIED",
                            eventData: {
                                results: {
                                    defender: results.defender,
                                    message: `${results.defender.name} was slain by ${results.attacker.name}.`
                                },
                                encounterTable
                            }
                        });

                        // Give drops to everyone who attacked the monster
                        for (var attacker in results.defender.aggro) {
                            for (var i in results.defender.drops) {
                                var drop = results.defender.drops[i];
                                var chanceRoll = Util.rollDice("1d100");
                                if (chanceRoll < drop.chance) {
                                    await Commands.giveItem("", attacker, drop.itemId);
                                    queue.unshift({ target, text: `${attacker} found ${itemTable[drop.itemId].name}!`, level: "simple" });
                                    sendEventToPanels({
                                        type: "ITEM_GET",
                                        eventData: {
                                            results: {
                                                receiver: attacker,
                                                item: itemTable[drop.itemId],
                                                message: `${attacker} found ${itemTable[drop.itemId].name}!`
                                            },
                                            encounterTable
                                        }
                                    });
                                    break;
                                }
                            }
                        }
                    }

                    break;
                case "!transmog":
                    if (context.username !== BROADCASTER_NAME && !context.mod) {
                        throw "Only a broadcaster or mod can turn a viewer into a slime";
                    }

                    if (tokens.length < 2) {
                        throw "You must specify a target to turn into a slime";
                    }

                    // If the encounter table is full, try to clean it up first
                    if (Object.keys(encounterTable).length >= configTable.maxEncounters) {
                        
                        // Do clean up of encounter table
                        Object.keys(encounterTable).forEach((name) => {
                            var monster = encounterTable[name];
                            if (monster.hp <= 0) {
                                delete encounterTable[name];                            
                            }
                        });

                        //If there are still too many, clean up
                        if (Object.keys(encounterTable).length >= configTable.maxEncounters) {
                            throw `Only ${configTable.maxEncounters} monster spawns allowed at a time`;
                        }
                    }

                    var transmogName = tokens[1];
                    tokens[1] = tokens[1].replace("@", "").toLowerCase();

                    if (tokens[1] === BROADCASTER_NAME) {
                        throw "You can't turn the broadcaster into a slime";
                    }

                    var slimeName = tokens[1].toLowerCase() + "_the_slime";
                    var monster = Commands.spawnMonster("SLIME", slimeName, gameContext);
                    monster.transmogName = transmogName;
                    encounterTable[monster.spawnKey] = monster;

                    queue.unshift({ target, text: `${tokens[1]} was turned into a slime and will be banned upon death.  Target name: ~${monster.spawnKey}.`, level: "simple" });
                    sendEventToPanels({
                        type: "SPAWN",
                        eventData: {
                            results: {
                                attacker: monster,
                                message: `${tokens[1]} was turned into a slime and will be banned upon death.  Target name: ~${monster.spawnKey}.`
                            },
                            encounterTable
                        }
                    });

                    break;
                case "!untransmog":
                    if (context.username !== BROADCASTER_NAME && !context.mod) {
                        throw "Only a broadcaster or mod can revert a slime";
                    }

                    if (tokens.length < 2) {
                        throw "You must specify a target to revert from a slime";
                    }

                    tokens[1] = tokens[1].replace("@", "").toLowerCase();

                    var monsterName = tokens[1].toLowerCase() + "_the_slime";

                    if (!encounterTable[monsterName]) {
                        throw `${tokens[1]} isn't a slime`;
                    }

                    delete encounterTable[monsterName];

                    queue.unshift({ target, text: `${tokens[1]} was reverted from a slime`, level: "simple" });

                    break;
                case "!spawn":
                    if (context.username !== BROADCASTER_NAME && !context.mod) {
                        throw "Only a broadcaster or mod can spawn monsters";
                    }

                    if (tokens.length < 2) {
                        throw "You must specify a monster to spawn";
                    }

                    // If the encounter table is full, try to clean it up first
                    if (Object.keys(encounterTable).length >= configTable.maxEncounters) {
                        
                        // Do clean up of encounter table
                        Object.keys(encounterTable).forEach((name) => {
                            var monster = encounterTable[name];
                            if (monster.hp <= 0) {
                                delete encounterTable[name];                            
                            }
                        });

                        //If there are still too many, clean up
                        if (Object.keys(encounterTable).length >= configTable.maxEncounters) {
                            throw `Only ${configTable.maxEncounters} monster spawns allowed at a time`;
                        }
                    }

                    // Retrieve monster from monster table
                    var monsterName = tokens[1];
                    var monster = await Commands.spawnMonster(monsterName, null, gameContext);
                    encounterTable[monster.spawnKey] = monster;

                    queue.unshift({ target, text: `${monster.name} has appeared!  Target name: ~${monster.spawnKey}.`, level: "simple" });
                    sendEventToPanels({
                        type: "SPAWN",
                        eventData: {
                            results: {
                                attacker: monster,
                                message: `${monster.name} has appeared!  Target name: ~${monster.spawnKey}.`
                            },
                            encounterTable
                        }
                    });

                    break;
                case "!stats":
                    var username = context.username;
                    if (tokens[1]) {
                        username = tokens[1].replace("@", "").toLowerCase();
                    }

                    var user = await Xhr.getUser(username);
                    user = Util.expandUser(user, gameContext);
                    queue.unshift({ target, text: `[${user.name}] HP: ${user.hp} -- MP: ${user.mp} -- AP: ${user.ap} -- STR: ${user.str} -- DEX: ${user.dex} -- INT: ${user.int} -- HIT: ${user.hit} -- AC: ${user.totalAC}.`, level: "simple" });
                    break;
                case "!targets":
                    var activeUsers = await Xhr.getActiveUsers(gameContext);
                    var monsterList = Object.keys(encounterTable).map((name) => {
                        var monster = encounterTable[name];
                        if (monster.hp >= 0) {
                            return `${monster.name} (~${name})`;
                        }
                    });
                    queue.unshift({ target, text: `Available targets are: ${[...activeUsers, ...monsterList]}`, level: "simple" });
                    break;
                case "!give":
                    if (tokens.length < 3) {
                        throw "Must provide a target and an item id to give";
                    }

                    user = tokens[1].replace("@", "").toLowerCase();
                    var itemId = tokens[2];

                    // Give from inventory if not a mod
                    if (context.username !== BROADCASTER_NAME && !context.mod) {
                        var results = await Commands.giveItemFromInventory(context.username, user, itemId, gameContext);

                        queue.unshift({ target, text: results.message, level: "simple" });
                        return;
                    }

                    // Give as mod
                    var results = await Commands.giveItem(context.username, user, itemId, target);

                    queue.unshift({ target, text: results.message, level: "simple" });

                    break;
                case "!help":
                    queue.unshift({ target, text: `Visit https://deusprogrammer.com/util/twitch to see how to use our in chat battle system.`, level: "simple" });
                    break;
                case "!inventory":
                    queue.unshift({ target, text: `${context.username} Visit https://deusprogrammer.com/util/twitch/battlers/${context.username} to view your inventory and stats.`, level: "simple" });
                    break;
                case "!refresh":
                    if (context.username !== BROADCASTER_NAME && !context.mod) {
                        throw "Only a mod or broadcaster can refresh the tables";
                    }

                    itemTable = await Xhr.getItemTable()
                    jobTable = await Xhr.getJobTable();
                    monsterTable = await Xhr.getMonsterTable();
                    abilityTable = await Xhr.getAbilityTable();

                    gameContext = { itemTable, jobTable, monsterTable, abilityTable, encounterTable, cooldownTable, chattersActive, configTable };

                    console.log(`* All tables refreshed`);

                    queue.unshift({ target, text: "All tables refreshed", level: "simple" });

                    break;
                case "!config":
                    if (context.username !== BROADCASTER_NAME && !context.mod) {
                        throw "Only a mod or broadcaster can change config values";
                    }

                    if (tokens.length < 3) {
                        throw "Must provide a config value and a value";
                    }

                    var configElement = tokens[1];
                    var configValue = tokens[2];

                    configTable[configElement] = configValue;

                    // TODO Eventually save this to config file

                    break;
                default:
                    throw `${tokens[0]} is an invalid command.`;
            }
        } catch (e) {
            queue.unshift({ target, text: `${e}`, level: "simple" });
        }
    }
}

// Called every time the bot connects to Twitch chat
async function onConnectedHandler(addr, port) {
    console.log(`* Connected to ${addr}:${port}`);

    itemTable = await Xhr.getItemTable()
    jobTable = await Xhr.getJobTable();
    monsterTable = await Xhr.getMonsterTable();
    abilityTable = await Xhr.getAbilityTable();
    // TODO Load config table from file

    gameContext = { itemTable, jobTable, monsterTable, abilityTable, encounterTable, cooldownTable, chattersActive, configTable };

    console.log(`* All tables loaded`);

    // QUEUE CUSTOMER
    setInterval(() => {
        let message = queue.pop();

        if (message) {
            if (message.level !== configTable.verbosity && message.level !== "simple") {
                return;
            }

            if (message.text.startsWith("/")) {
                client.say(message.target, message.text);
            } else {
                client.say(message.target, "/me " + message.text);
            }
        }
    }, 2000);

    // MAIN LOOP
    try {
        setInterval(() => {
            // Check for chatter activity timeouts
            Object.keys(chattersActive).forEach(async (username) => {
                chattersActive[username] -= 1;
                if (chattersActive[username] === 0) {
                    delete chattersActive[username];
                    queue.unshift({ target: "thetruekingofspace", text: `${username} has stepped back into the shadows.`, level: "simple" });
                }
            });

            // Tick down human cooldowns
            Object.keys(cooldownTable).forEach(async (username) => {
                cooldownTable[username] -= 1;
                if (cooldownTable[username] <= 0) {
                    delete cooldownTable[username];
                    queue.unshift({ target: "thetruekingofspace", text: `${username} can act again.`, level: "simple" });
                }
            });

            // Do monster attacks
            Object.keys(encounterTable).forEach(async (encounterName) => {
                var encounter = encounterTable[encounterName];

                if (encounter.hp <= 0) {
                    return;
                }

                // If the monster has no tick, reset it.
                if (encounter.tick === undefined) {
                    encounter.tick = encounter.actionCooldown;
                }

                // If cooldown timer for monster is now zero, do an attack.
                if (encounter.tick === 0) {
                    encounter.tick = encounter.actionCooldown;

                    // If no aggro, pick randomly.  If aggro, pick highest damage dealt.
                    var target = null;
                    if (!encounter.aggro || Object.keys(encounter.aggro).length <= 0) {
                        let activeUsers = await Xhr.getActiveUsers(gameContext);

                        if (activeUsers.length > 0) {
                            target = activeUsers[Math.floor(Math.random() * Math.floor(activeUsers.length))];
                        }
                    } else {
                        Object.keys(encounter.aggro).forEach((attackerName) => {
                            var attackerAggro = encounter.aggro[attackerName];
                            if (target === null) {
                                target = attackerName;
                                return;
                            }

                            if (attackerAggro > encounter.aggro[target]) {
                                target = attackerName;
                            }
                        });
                    }

                    // If a target was found
                    if (target !== null) {
                        var results = await Commands.attack("~" + encounterName, target, gameContext);
                        queue.unshift({ target: "thetruekingofspace", text: `${results.message}`, level: "verbose" });
                        sendEventToPanels({
                            type: "ATTACK",
                            eventData: {
                                results: {
                                    attacker: results.attacker,
                                    defender: results.defender,
                                    message: `${results.attacker.name} hit ${results.defender.name} for ${results.damage} damage.`
                                },
                                encounterTable
                            }
                        });

                        if (results.defender.hp <= 0) {
                            sendEventToPanels({
                                type: "DIED",
                                eventData: {
                                    results: {
                                        attacker: results.attacker,
                                        defender: results.defender,
                                        message: `${results.defender.name} was slain by ${results.attacker.name}.`
                                    },
                                    encounterTable
                                }
                            });
                        }

                        return;
                    }
                }

                encounter.tick--;
            });
        }, 5 * 1000);
    } catch (e) {
        queue.unshift({ target: "thetruekingofspace", text: e, level: "simple" });
    };

    // Advertising message
    setInterval(() => {
        queue.unshift({ target: "thetruekingofspace", text: "Visit https://deusprogrammer.com/util/twitch to see how to use our in chat battle system.", level: "simple" });
    }, 5 * 60 * 1000);

    // Announce restart
    queue.unshift({ target: "thetruekingofspace", text: "I have restarted.  All monsters that were active are now gone.", level: "simple" });

    // Start redemption listener
    Redemption.startListener(queue);
}