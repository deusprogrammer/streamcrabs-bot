const tmi = require('tmi.js');
const WebSocket = require('ws');

const Util = require('./util');
const Xhr = require('./xhr');
const Commands = require('./commands');
const Redemption = require('./redemption');
const xhr = require('./xhr');

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
let buffTable = {};

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

const sendEvent = async (event, verbosity = "simple") => {
    queue.unshift({event, level: verbosity});
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
                        sendEvent({
                            type: "JOIN",
                            targets: ["chat", "panel"],
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
                case "!use":
                    if (tokens.length < 2) {
                        throw "You must have an name for your ability.";
                    }

                    if (cooldownTable[context.username]) {
                        throw `${context.username} is on cooldown.`;
                    }

                    var isItem = false;
                    var itemName = "";
                    var foundIndex = -1;
                    var attackerName = context.username;
                    var abilityName = tokens[1].toUpperCase();
                    var defenderName = tokens[2] ? tokens[2].replace("@", "").toLowerCase() : null;
                    var attacker = await Commands.getTarget(attackerName, gameContext);
                    var targets = await Xhr.getActiveUsers(gameContext);
                    var aliveMonsters = Object.keys(encounterTable).map(monster => "~" + monster);

                    if (abilityName.startsWith("#")) {
                        itemName = abilityName.substring(1).toUpperCase();
                        var item = itemTable[itemName];
                        foundIndex = attacker.inventory.findIndex(inventoryItem => inventoryItem.id === itemName);

                        if (!item) {
                            throw(`Item with id ${itemName} doesn't exist.`);
                        }

                        if (foundIndex < 0) {
                            throw(`User doesn't have ${item.name} to use.`)
                        }

                        if (item.type.toUpperCase() !== "CONSUMABLE") {
                            throw(`${item.name} is not consumable`);
                        }


                        abilityName = item.use;
                        isItem = true;
                    }

                    var ability = abilityTable[abilityName];

                    if (!ability) {
                        throw `Ability named ${abilityName} doesn't exist goofball.`;
                    }

                    if (!attacker) {
                        throw `${attackerName} doesn't have a battler.`;
                    }

                    if (!isItem && !attacker.abilities[abilityName]) {
                        throw `${attackerName} doesn't have ability ${abilityName}.`;
                    }

                    if (isItem) {
                        ability.ap = 0;
                    }

                    if (Math.max(0, attacker.ap) <= ability.ap) {
                        throw `@${attackerName} needs ${ability.ap} AP to use this ability.`;
                    }

                    var abilityTargets = [];
                    if (!defenderName) {
                        if (ability.area === "ONE" && ability.target !== "CHAT") {
                            throw `${abilityName} cannot target all opponents.  You must specify a target.`;
                        } else if (ability.area === "ONE" && ability.target === "CHAT") {
                            abilityTargets = [attackerName];
                        } else if (ability.area == "ALL" && ability.target === "ENEMY") {
                            abilityTargets = aliveMonsters;
                        } else if (ability.area == "ALL" && ability.target === "CHAT") {
                            abilityTargets = targets;
                        } else {
                            abilityTargets = [...targets, ...aliveMonsters];
                        }
                    } else {
                        if (ability.area === "ALL") {
                            throw `${abilityName} cannot target just one opponent.`;
                        }

                        abilityTargets = [defenderName];
                    }

                    if (!isItem) {
                        sendEvent({
                            type: "INFO",
                            targets: ["chat", "panel"],
                            eventData: {
                                results: {
                                    attacker,
                                    message: `${attacker.name} uses ${ability.name}`
                                },
                                encounterTable
                            }
                        });
                    } else {
                        sendEvent({
                            type: "INFO",
                            targets: ["chat", "panel"],
                            eventData: {
                                results: {
                                    attacker,
                                    message: `${attacker.name} uses a ${itemName}`
                                },
                                encounterTable
                            }
                        });
                    }

                    // Perform ability on everyone
                    for (var i in abilityTargets) {
                        var abilityTarget = abilityTargets[i];

                        var results = {};

                        if (ability.element === "HEALING") {
                            results = await Commands.heal(attackerName, abilityTarget, ability, gameContext);
                        } else if (ability.element === "BUFFING") {
                            results = await Commands.buff(attackerName, abilityTarget, ability, gameContext);
                        } else {
                            results = await Commands.hurt(attackerName, abilityTarget, ability, gameContext);
                        }

                        // Announce results of attack
                        if (results.damageType === "HEALING") {
                            sendEvent({
                                type: "HEALING",
                                targets: ["chat", "panel"],
                                eventData: {
                                    results: {
                                        attacker: results.attacker,
                                        defender: results.defender,
                                        message: results.message
                                    },
                                    encounterTable
                                }
                            });
                        } else if (results.damageType === "BUFFING") {
                            sendEvent({
                                type: "BUFFING",
                                targets: ["chat", "panel"],
                                eventData: {
                                    results: {
                                        attacker: results.attacker,
                                        defender: results.defender,
                                        message: results.message
                                    },
                                    encounterTable
                                }
                            });
                        } else if (results.damageType !== "HEALING" && results.flags.hit) {
                            let message = `${results.attacker.name} hit ${results.defender.name} for ${results.damage} damage.`;
                            if (results.flags.crit) {
                                message = `${results.attacker.name} scored a critical hit on ${results.defender.name} for ${results.damage} damage.`;
                            }

                            sendEvent({
                                type: "ATTACKED",
                                targets: ["chat", "panel"],
                                eventData: {
                                    results: {
                                        attacker: results.attacker,
                                        defender: results.defender,
                                        message
                                    },
                                    encounterTable
                                }
                            });
                        } else {
                            sendEvent({
                                type: "ATTACKED",
                                targets: ["chat", "panel"],
                                eventData: {
                                    results: {
                                        attacker: results.attacker,
                                        defender: results.defender,
                                        message: `${results.attacker.name} swings at ${results.defender.name} and misses.`
                                    },
                                    encounterTable
                                }
                            });
                        }

                        if (results.flags.dead) {
                            if (results.defender.isMonster) {
                                delete encounterTable[results.defender.spawnKey];
                                var itemGets = await Commands.distributeLoot(results.defender, gameContext);

                                itemGets.forEach((itemGet) => {
                                    sendEvent(itemGet);
                                })
                            }
                            
                            sendEvent({
                                type: "DIED",
                                targets: ["chat", "panel"],
                                eventData: {
                                    results: {
                                        defender: results.defender,
                                        message: `${results.defender.name} was slain by ${results.attacker.name}.`
                                    },
                                    encounterTable
                                }
                            });
                        }
                    }

                    // Get basic user to update
                    var updatedAttacker = await Xhr.getUser(context.username);

                    // Update ap
                    updatedAttacker.ap -= ability.ap;

                    // If item, remove from inventory
                    if (isItem) {
                        foundIndex = updatedAttacker.inventory.findIndex(name => name === itemName);
                        updatedAttacker.inventory.splice(foundIndex, 1);
                    }

                    // Get basic user to update
                    Xhr.updateUser(updatedAttacker);

                    // Set user active if they attack
                    if (!chattersActive[context.username]) {
                        chattersActive[context.username] = 10 * 12;
                    }

                    // Set user cool down
                    cooldownTable[context.username] = attacker.actionCooldown;

                    break;
                case "!attack":
                    if (tokens.length < 2) {
                        throw "You must have a target for your attack.";
                    }

                    var defenderName = tokens[1].replace("@", "").toLowerCase();

                    if (cooldownTable[context.username]) {
                        throw `${context.username} is on cooldown.`;
                    }

                    var results = await Commands.attack(context.username, defenderName, gameContext);

                    // Set user cool down
                    cooldownTable[context.username] = results.attacker.actionCooldown;

                    // Set user active if they attack
                    if (!chattersActive[context.username]) {
                        chattersActive[context.username] = 10 * 12;
                    }

                    if (results.flags.hit) {
                        let message = `${results.attacker.name} hit ${results.defender.name} for ${results.damage} damage.`;
                        if (results.flags.crit) {
                            message = `${results.attacker.name} scored a critical hit on ${results.defender.name} for ${results.damage} damage.`;
                        }

                        sendEvent({
                            type: "ATTACKED",
                            targets: ["chat", "panel"],
                            eventData: {
                                results: {
                                    attacker: results.attacker,
                                    defender: results.defender,
                                    message
                                },
                                encounterTable
                            }
                        });
                    } else {
                        sendEvent({
                            type: "ATTACKED",
                            targets: ["chat", "panel"],
                            eventData: {
                                results: {
                                    attacker: results.attacker,
                                    defender: results.defender,
                                    message: `${results.attacker.name} swings at ${results.defender.name} and misses.`
                                },
                                encounterTable
                            }
                        });
                    }

                    if (results.flags.dead) {
                        if (results.defender.isMonster) {
                            delete encounterTable[results.defender.spawnKey];
                            var itemGets = await Commands.distributeLoot(results.defender, gameContext);

                            itemGets.forEach((itemGet) => {
                                sendEvent(itemGet);
                            })
                        }

                        sendEvent({
                            type: "DIED",
                            targets: ["chat", "panel"],
                            eventData: {
                                results: {
                                    defender: results.defender,
                                    message: `${results.defender.name} was slain by ${results.attacker.name}.`
                                },
                                encounterTable
                            }
                        });
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

                    sendEvent({
                        type: "SPAWN",
                        targets: ["chat", "panel"],
                        eventData: {
                            results: {
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

                    break;
                case "!explore":
                    // If there are too many encounters, fail
                    if (Object.keys(encounterTable).length >= configTable.maxEncounters) {
                        throw `All adventurers are busy with monsters right now.`;
                    }

                    var lowLevelMonsters = Object.keys(monsterTable).filter(name => monsterTable[name].rarity < 5);
                    var randomMonster = lowLevelMonsters[Util.randomNumber(lowLevelMonsters.length) - 1];

                    // Retrieve monster from monster table
                    var monsterName = randomMonster;
                    var monster = await Commands.spawnMonster(monsterName, null, gameContext);
                    encounterTable[monster.spawnKey] = monster;

                    sendEvent({
                        type: "SPAWN",
                        targets: ["chat", "panel"],
                        eventData: {
                            results: {
                                message: `${monster.name} has appeared!  Target name: ~${monster.spawnKey}.`
                            },
                            encounterTable
                        }
                    });

                    break;
                case "!spawn":
                    if (context.username !== BROADCASTER_NAME && !context.mod) {
                        throw "Only a broadcaster or mod can spawn monsters";
                    }

                    if (tokens.length < 2) {
                        throw "You must specify a monster to spawn";
                    }

                    // If there are too many encounters, fail
                    if (Object.keys(encounterTable).length >= configTable.maxEncounters) {
                        throw `Only ${configTable.maxEncounters} monster spawns allowed at a time`;
                    }

                    // Retrieve monster from monster table
                    var monsterName = tokens[1];
                    var monster = await Commands.spawnMonster(monsterName, null, gameContext);
                    encounterTable[monster.spawnKey] = monster;

                    sendEvent({
                        type: "SPAWN",
                        targets: ["chat", "panel"],
                        eventData: {
                            results: {
                                message: `${monster.name} has appeared!  Target name: ~${monster.spawnKey}.`
                            },
                            encounterTable
                        }
                    });

                    break;
                case "!stats":
                    var username = context.username;
                    let buffs = Commands.createBuffMap(username, gameContext);
                    if (tokens[1]) {
                        username = tokens[1].replace("@", "").toLowerCase();
                    }

                    var user = await Xhr.getUser(username);
                    user = Util.expandUser(user, gameContext);
                    sendEvent({
                        type: "INFO",
                        targets: ["chat"],
                        eventData: {
                            results: {
                                message: `[${user.name}] HP: ${user.hp} -- AP: ${user.ap} -- STR: ${user.str} (${Util.sign(buffs.str)}) -- DEX: ${user.dex} (${Util.sign(buffs.dex)}) -- INT: ${user.int} (${Util.sign(buffs.int)}) -- HIT: ${Util.sign(user.hit)} (${Util.sign(buffs.hit)}) -- AC: ${user.totalAC} (${Util.sign(buffs.ac)}).`
                            },
                            encounterTable
                        }
                    });
                    break;
                case "!targets":
                    var activeUsers = await Xhr.getActiveUsers(gameContext);
                    var monsterList = Object.keys(encounterTable).map((name) => {
                        var monster = encounterTable[name];
                        if (monster.hp >= 0) {
                            return `${monster.name} (~${name})`;
                        }
                    });
                    sendEvent({
                        type: "INFO",
                        targets: ["chat"],
                        eventData: {
                            results: {
                                message: `Available targets are: ${[...activeUsers, ...monsterList]}`
                            },
                            encounterTable
                        }
                    });
                    break;
                case "!give":
                    if (tokens.length < 3) {
                        throw "Must provide a target and an item id to give";
                    }

                    user = tokens[1].replace("@", "").toLowerCase();
                    var itemId = tokens[2];

                    var results = await Commands.giveItemFromInventory(context.username, user, itemId, gameContext);

                    sendEvent({
                        type: "ITEM_GIVE",
                        targets: ["chat"],
                        eventData: {
                            results,
                            encounterTable
                        }
                    });

                    break;
                case "!gift":
                    if (tokens.length < 3) {
                        throw "Must provide a target and an item id to give";
                    }

                    user = tokens[1].replace("@", "").toLowerCase();
                    var itemId = tokens[2];

                    // Give from inventory if not a mod
                    if (context.username !== BROADCASTER_NAME && !context.mod) {
                        throw "Only a mod can gift an item to someone";
                    }

                    // Give as mod
                    var results = await Commands.giveItem(context.username, user, itemId, target);

                    sendEvent({
                        type: "ITEM_GIFT",
                        targets: ["chat"],
                        eventData: {
                            results,
                            encounterTable
                        }
                    });

                    break;
                case "!help":
                    sendEvent({
                        type: "INFO",
                        targets: ["chat"],
                        eventData: {
                            results: {
                                message: `Visit https://deusprogrammer.com/util/twitch to see how to use our in chat battle system.`
                            },
                            encounterTable
                        }
                    });
                    break;
                case "!inventory":
                case "!abilities":
                    sendEvent({
                        type: "INFO",
                        targets: ["chat"],
                        eventData: {
                            results: {
                                message: `${context.username} Visit https://deusprogrammer.com/util/twitch/battlers/${context.username} to view your inventory, abilities and stats.`
                            },
                            encounterTable
                        }
                    });
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

                    sendEvent({
                        type: "INFO",
                        targets: ["chat"],
                        eventData: {
                            results: {
                                message: "All tables refreshed"
                            },
                            encounterTable
                        }
                    });
                    
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
                case "!reset":
                    gameContext.encounterTable = {};
                    sendEvent({
                        type: "INFO",
                        targets: ["chat"],
                        eventData: {
                            results: {
                                message: "Clearing encounter table."
                            },
                            encounterTable
                        }
                    });
                    break;
                case "!goodnight":
                case "!shutdown":
                    sendEvent({
                        type: "INFO",
                        targets: ["chat"],
                        eventData: {
                            results: {
                                message: "Miku going offline.  Oyasumi."
                            },
                            encounterTable
                        }
                    });
                    setTimeout(() => {
                        process.exit(0);
                    }, 5000);
                    break;
                default:
                    throw `${tokens[0]} is an invalid command.`;
            }
        } catch (e) {
            sendEvent({
                type: "ERROR",
                targets: ["chat"],
                eventData: {
                    results: {
                        message: new Error(e)
                    },
                    encounterTable
                }
            });
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

    gameContext = { itemTable, jobTable, monsterTable, abilityTable, encounterTable, cooldownTable, buffTable, chattersActive, configTable };

    console.log(`* All tables loaded`);

    // QUEUE CUSTOMER
    setInterval(async () => {
        let message = queue.pop();

        if (message) {
            let event = message.event;
            let text = event.eventData.results.message;

            if (!event.targets) {
                event.targets = ["chat"];
            }

            if (typeof text === "object" && text.stack) {
                console.error("ERROR: " + text.message + ":\n" + text.stack);
                text = text.message;
            } else {
                console.log("TEXT: " + text);
            }

            if (message.level !== configTable.verbosity && message.level !== "simple") {
                return;
            }

            // Send event to chat
            if (event.targets.includes("chat")) {
                if (text.startsWith("/")) {
                    client.say(BROADCASTER_NAME, text);
                } else {
                    client.say(BROADCASTER_NAME, "/me " + text);
                }
            }
            // Send event to panel via web socket
            if (event.targets.includes("panel")) {
                sendEventToPanels(event);
            }

            // Handle different events that pertain to the bot's personality
            await mikuEventHandler(client, event);
        }
    }, 500);

    // MAIN LOOP
    try {
        setInterval(async () => {
            // Check for chatter activity timeouts
            Object.keys(chattersActive).forEach(async (username) => {
                chattersActive[username] -= 1;
                if (chattersActive[username] === 0) {
                    delete chattersActive[username];
                    sendEvent({
                        type: "INFO",
                        targets: ["chat"],
                        eventData: {
                            results: {
                                message:  `${username} has stepped back into the shadows.`
                            },
                            encounterTable
                        }
                    });
                }
            });

            // Tick down human cooldowns
            Object.keys(cooldownTable).forEach(async (username) => {
                cooldownTable[username] -= 1;
                if (cooldownTable[username] <= 0) {
                    delete cooldownTable[username];
                    sendEvent({
                        type: "INFO",
                        targets: ["chat"],
                        eventData: {
                            results: {
                                message:  `${username} can act again.`
                            },
                            encounterTable
                        }
                    });
                }
            });

            // Tick down buff timers
            Object.keys(buffTable).forEach((username) => {
                var buffs = buffTable[username] || [];
                console.log(`${username} buffs:\n${JSON.stringify(buffTable[username], null, 5)}`);
                buffs.forEach((buff) => {
                    buff.duration--;
                })
                buffTable[username] = buffs.filter(buff => buff.duration > 0);
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
                        sendEvent({
                            type: "ATTACK",
                            targets: ["chat", "panel"],
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
                            sendEvent({
                                type: "DIED",
                                targets: ["chat", "panel"],
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
        sendEvent({
            type: "ERROR",
            targets: ["chat"],
            eventData: {
                results: {
                    message: e
                },
                encounterTable
            }
        });
    };

    // Advertising message
    setInterval(async () => {
        sendEvent({
            type: "INFO",
            targets: ["chat"],
            eventData: {
                results: {
                    message: "Visit https://deusprogrammer.com/util/twitch to see how to use our in chat battle system."
                },
                encounterTable
            }
        });
    }, 5 * 60 * 1000);

    // Announce restart
    sendEvent({
        type: "INFO",
        targets: ["chat"],
        eventData: {
            results: {
                message: "Miku is online.  All systems nominal."
            },
            encounterTable
        }
    });

    // Start redemption listener
    Redemption.startListener(queue);
}

// MIKU'S HEART

const flaggedUsers = {};

const gatherMikusThings = async (username) => {
    let user = await Commands.getTarget(username, gameContext);
    let mikusItems = Object.keys(user.inventory).map(key => user.inventory[key].name).filter(itemName => itemName.startsWith("Miku's"));
    let mikusEquip = Object.keys(user.equipment).map(key => user.equipment[key].name).filter(itemName => itemName.startsWith("Miku's"));
    let mikusItemsAll = [...mikusItems, ...mikusEquip];
    
    return mikusItemsAll;
}
 
const mikuEventHandler = async (client, event) => {
    // If the user get's an item that belong's to Miku, have her react
    if (event.type === "ITEM_GET" && event.eventData.results.item.name.startsWith("Miku's")) {
        client.say(BROADCASTER_NAME, `W...wait!  Give back my ${event.eventData.results.item.name.replace("Miku's", "").toLowerCase()} >//<!`);
        flaggedUsers[event.eventData.results.receiver.name] = true;
    } else if (event.type === "ITEM_GIVE" && event.eventData.results.item.name.startsWith("Miku's")) {
        if (event.eventData.results.receiver.name !== "miku_the_space_bot") {
            client.say(BROADCASTER_NAME, `WHY ARE YOU TRADING THOSE?!  My ${event.eventData.results.item.name.replace("Miku's", "").toLowerCase()} aren't Pokemon cards >_<!`);
            flaggedUsers[event.eventData.results.receiver.name] = true;
            flaggedUsers[event.eventData.results.giver.name] = true;
        } else {
            let username = event.eventData.results.giver.name;
            let mikusThings = await gatherMikusThings(username);
            if (mikusThings.length > 0) {
                client.say(BROADCASTER_NAME, `Oh, ${username}...you're giving these back?  Hmmmmm...are you sure you don't have something else of mine...like my ${mikusThings.map(name => name.replace("Miku's", "").toLowerCase())[0]}.`);
            } else {
                client.say(BROADCASTER_NAME, `Oh, ${username}...you're giving these back?  Hmmmmm...I guess I forgive you...baka.`);
                flaggedUsers[event.eventData.results.giver.name] = false;
            }
        }
    } else if (event.type === "ITEM_GIFT" && event.eventData.results.item.name.startsWith("Miku's")) {
        client.say(BROADCASTER_NAME, `WHERE DID YOU GET THOSE?!  I don't think I'm missing my ${event.eventData.results.item.name.replace("Miku's", "").toLowerCase()}...OMFG...WHERE DID THEY GO O//O;?`);
        flaggedUsers[event.eventData.results.receiver.name] = true;
        flaggedUsers[event.eventData.results.giver.name] = true;
    } else if (event.type === "JOIN") {
        let username = event.eventData.results.attacker.name;
        let mikusThings = await gatherMikusThings(username);
        if (mikusThings.length > 0) {
            client.say(BROADCASTER_NAME, `I see you still have my ${mikusThings.map(name => name.replace("Miku's", "").toLowerCase())[0]} and probably other things...hentai.`);
            flaggedUsers[username] = true;
        }
    }
}