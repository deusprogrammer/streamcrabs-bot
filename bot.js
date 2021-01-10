const tmi = require('tmi.js');
const WebSocket = require('ws');
const jsonwebtoken = require('jsonwebtoken');

const Util = require('./util');
const Xhr = require('./xhr');
const Commands = require('./commands');
const Redemption = require('./redemption');

const TWITCH_EXT_CHANNEL_ID = process.env.TWITCH_EXT_CHANNEL_ID;

const versionNumber = "1.1b";

// TODO Move these into an async function so we can use await

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
let dotTable = {};

let botConfig = {};
let client = {};

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

const createExpirationDate = () => {
    var d = new Date();
    var year = d.getFullYear();
    var month = d.getMonth();
    var day = d.getDate();
    var c = new Date(year + 1, month, day);
    return c;
}

const createJwt = (secret) => {
    return jsonwebtoken.sign({
        "exp": createExpirationDate().getTime(),
        "user_id": `BOT-${TWITCH_EXT_CHANNEL_ID}`,
        "role": "moderator",
        "channel_id": TWITCH_EXT_CHANNEL_ID,
        "pubsub_perms": {
            "send":[
                "broadcast"
            ]
        }
    }, secret);
}

// Setup websocket to communicate with extension
let extWs = null;
const connectWs = (config) => {
    extWs = new WebSocket('wss://deusprogrammer.com/api/ws/twitch');
 
    extWs.on('open', () => {
        console.log("OPENED WS");
        extWs.send(JSON.stringify({
            type: "REGISTER",
            channelId: TWITCH_EXT_CHANNEL_ID,
            jwt: createJwt(config.sharedSecretKey),
        }));

        extWs.send(JSON.stringify({
            type: "STARTUP",
            channelId: TWITCH_EXT_CHANNEL_ID,
            jwt: createJwt(config.sharedSecretKey),
            to: "ALL"
        }));

        // Keep connection alive
        pingInterval = setInterval(() => {
            extWs.send(JSON.stringify({
                type: "PING_SERVER",
                channelId: TWITCH_EXT_CHANNEL_ID,
                jwt: createJwt(config.sharedSecretKey),
            }));
        }, 20 * 1000);
    });

    extWs.on('message', async (message) => {
        let event = JSON.parse(message);

        // Ignore messages originating from bot
        if (["SERVER", `BOT-${TWITCH_EXT_CHANNEL_ID}`].includes(event.from)) {
            return;
        }

        console.log("EVENT: " + JSON.stringify(event, null, 5));

        // If it's just a panel listener requesting initialization, just do it marrrrrrk.
        if (event.type === "PANEL_INIT") {
            extWs.send(JSON.stringify({
                type: "INIT",
                channelId: TWITCH_EXT_CHANNEL_ID,
                jwt: createJwt(config.sharedSecretKey),
                to: event.from,
                eventData: {
                    results: {},
                    encounterTable
                }
            }));

            return;
        }

        // Validate ws server signature
        let signature = event.signature;
        let actualSignature = Util.hmacSHA1(botConfig.sharedSecretKey, event.to + event.from + event.ts);

        if (signature !== actualSignature) {
            console.error("Dropping message due to signature mismatch");
            console.error(`${signature} !== ${actualSignature}`);
            return;
        }

        // Handle message
        if (event.type === "COMMAND") {
            onMessageHandler(botConfig.twitchChannel, {username: event.fromUser, "user-id": event.from, mod: false}, event.message, false);
            const caller = {
                id: event.from,
                name: event.fromUser
            }
            sendContextUpdate([caller]);
        } else if (event.type === "CONTEXT" && event.to !== "ALL") {
            console.log("CONTEXT REQUEST FROM " + event.from);
            let players = await Xhr.getActiveUsers(gameContext);
            extWs.send(JSON.stringify({
                type: "CONTEXT",
                channelId: TWITCH_EXT_CHANNEL_ID,
                jwt: createJwt(config.sharedSecretKey),
                to: event.from,
                data: {
                    players,
                    monsters: Object.keys(encounterTable).map(key => `~${key}`),
                    cooldown: cooldownTable[event.fromUser],
                    buffs: buffTable[event.fromUser]
                }
            }));
        } else if (event.type === "PING") {
            extWs.send(JSON.stringify({
                type: "PONG",
                channelId: TWITCH_EXT_CHANNEL_ID,
                jwt: createJwt(config.sharedSecretKey),
                to: event.from,
            }));
        }
    });

    extWs.on('close', (e) => {
        console.log('Socket is closed. Reconnect will be attempted in 5 second.', e.reason);
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
        }
        setTimeout(() => {
            connectWs();
        }, 5000);
    });

    extWs.on('error', (e) => {
        console.error('Socket encountered error: ', e.message, 'Closing socket');
        extWs.close();
    });
}

const sendContextUpdate = async (targets, shouldRefresh = false) => {
    let players = await Xhr.getActiveUsers(gameContext);
    if (targets) {
        targets.forEach((target) => {
            extWs.send(JSON.stringify({
                type: "CONTEXT",
                channelId: TWITCH_EXT_CHANNEL_ID,
                jwt: createJwt(botConfig.sharedSecretKey),
                to: target.id,
                data: {
                    players,
                    monsters: Object.keys(encounterTable).map(key => `~${key}`),
                    buffs: buffTable[target.name],
                    cooldown: cooldownTable[target.name],
                    shouldRefresh
                }
            }));
        });
    } else {
        extWs.send(JSON.stringify({
            type: "CONTEXT",
            channelId: TWITCH_EXT_CHANNEL_ID,
            jwt: createJwt(botConfig.sharedSecretKey),
            to: "ALL",
            data: {
                players,
                monsters: Object.keys(encounterTable).map(key => `~${key}`),
                shouldRefresh
            }
        }));
    }
}

// TODO Eventually collapse this into the one websocket
const sendEventToPanels = async (event) => {
    event.channelId = TWITCH_EXT_CHANNEL_ID;
    event.to = "PANELS";
    event.jwt = createJwt(botConfig.sharedSecretKey);
    extWs.send(JSON.stringify(event));
}

const sendEvent = async (event, verbosity = "simple") => {
    queue.unshift({event, level: verbosity});
}

const sendInfoToChat = async (message, includePanel = false) => {
    let targets = ["chat"]

    if (includePanel) {
        targets.push("panel");
    }

    sendEvent({
        type: "INFO",
        targets,
        eventData: {
            results: {
                message
            }
        }
    })
}

const sendErrorToChat = async(message) => {
    let targets = ["chat"]

    sendEvent({
        type: "INFO",
        targets,
        eventData: {
            results: {
                message
            }
        }
    })
}

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

        console.log("* Retrieved bot config");

        // Create a client with our options
        client = new tmi.client(opts);

        // Register our event handlers (defined below)
        client.on('message', onMessageHandler);
        client.on('connected', onConnectedHandler);

        // Connect to Twitch:
        client.connect();
    } catch (error) {
        console.error(`* Failed to start bot: ${error}`);
    }
};
startBot();

// Called every time a message comes in
async function onMessageHandler(target, context, msg, self) {
    if (self) { return; } // Ignore messages from the bot

    // Reset a players activity tick to a full 10 minutes before we check again
    if (chattersActive[context.username]) {
        chattersActive[context.username] = 10 * 12;
    }

    const caller = {
        id: context["user-id"],
        name: context.username
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

                    sendContextUpdate();

                    break;
                case "!use":
                    if (tokens.length < 2) {
                        throw "You must have an name for your ability.";
                    }

                    if (cooldownTable[context.username]) {
                        throw `${context.username} is on cooldown.`;
                    }

                    // Set user active if they attack
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

                    if (Math.max(0, attacker.ap) < ability.ap) {
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
                        } else if (ability.element === "CLEANSING") {
                            results = await Commands.cleanse(attackerName, abilityTarget, ability, gameContext);
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
                        } else if (results.damageType === "CLEANSING") {
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
                        } else if (
                                results.damageType !== "HEALING" &&
                                results.damageType !== "BUFFING" && 
                                results.damageType !== "CLEANSING" && 
                                results.flags.hit) {
                            let message = `${results.attacker.name} hit ${results.defender.name} for ${results.damage} ${results.damageStat} damage.`;
                            if (results.flags.crit) {
                                message = `${results.attacker.name} scored a critical hit on ${results.defender.name} for ${results.damage} ${results.damageStat} damage.`;
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
                        } else if (
                            results.damageType !== "HEALING" &&
                            results.damageType !== "BUFFING" &&
                            results.damageType !== "CLEANSING" && 
                            !results.flags.hit
                        ) {
                            sendEvent({
                                type: "ATTACKED",
                                targets: ["chat", "panel"],
                                eventData: {
                                    results: {
                                        attacker: results.attacker,
                                        defender: results.defender,
                                        message: `${results.attacker.name} used ${ability.name} on ${results.defender.name} and missed.`
                                    },
                                    encounterTable
                                }
                            });
                        }

                        // Show trigger results
                        for (const triggerResult of results.triggerResults) {
                            sendEvent({
                                type: "INFO",
                                targets: ["chat", "panel"],
                                eventData: {
                                    results: {
                                        attacker: triggerResult.results.attacker,
                                        defender: triggerResult.results.defender,
                                        message: `${results.attacker.name} triggered ${triggerResult.trigger.ability.name}!`
                                    },
                                    encounterTable
                                }
                            });
                        }

                        if (results.flags.dead) {
                            if (results.defender.isMonster) {
                                if (results.defender.transmogName) {
                                    client.say(botConfig.twitchChannel, `/ban ${results.defender.transmogName}`);
                                }

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

                            sendContextUpdate();
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
                    await Xhr.updateUser(updatedAttacker);

                    sendContextUpdate([updatedAttacker], true);

                    // Set user cool down
                    var currBuffs = Commands.createBuffMap(context.username, gameContext);
                    cooldownTable[context.username] = Math.min(11, 6 - Math.min(5, attacker.dex + currBuffs.dex));

                    break;
                case "!attack":
                    if (tokens.length < 2) {
                        throw "You must have a target for your attack.";
                    }
                    var attacker = await Commands.getTarget(context.username, gameContext);
                    var attackerName = context.username.toLowerCase();
                    var defenderName = tokens[1].replace("@", "").toLowerCase();

                    if (cooldownTable[context.username]) {
                        throw `${context.username} is on cooldown.`;
                    }

                    var results = await Commands.attack(context.username, defenderName, gameContext);

                    // Set user cool down
                    var currBuffs = Commands.createBuffMap(context.username, gameContext);
                    cooldownTable[context.username] = Math.min(11, 6 - Math.min(5, attacker.dex + currBuffs.dex));

                    // Set user active if they attack
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

                    if (results.flags.hit) {
                        let message = `${results.attacker.name} hit ${results.defender.name} for ${results.damage} ${results.damageStat} damage.`;
                        if (results.flags.crit) {
                            message = `${results.attacker.name} scored a critical hit on ${results.defender.name} for ${results.damage} ${results.damageStat} damage.`;
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
                                    message: `${results.attacker.name} attacked ${results.defender.name} and missed.`
                                },
                                encounterTable
                            }
                        });
                    }

                    // Show trigger results
                    for (const triggerResult of results.triggerResults) {
                        sendEvent({
                            type: "INFO",
                            targets: ["chat", "panel"],
                            eventData: {
                                results: {
                                    attacker: triggerResult.results.attacker,
                                    defender: triggerResult.results.defender,
                                    message: `${results.attacker.name}'s ${results.attacker.equipment.hand.name}'s ${triggerResult.trigger.ability.name} activated!`
                                },
                                encounterTable
                            }
                        });
                    }

                    if (results.flags.dead) {
                        if (results.defender.isMonster) {
                            if (results.defender.transmogName) {
                                client.say(botConfig.twitchChannel, `/ban ${results.defender.transmogName}`);
                            }

                            delete encounterTable[results.defender.spawnKey];
                            var itemGets = await Commands.distributeLoot(results.defender, gameContext);

                            itemGets.forEach((itemGet) => {
                                sendEvent(itemGet);
                            });

                            sendContextUpdate();
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

                    sendContextUpdate([results.attacker, results.defender], true);

                    break;
                case "!transmog":
                    if (context.username !== botConfig.twitchChannel && !context.mod) {
                        throw "Only a broadcaster or mod can turn a viewer into a slime";
                    }

                    if (tokens.length < 2) {
                        throw "You must specify a target to turn into a slime";
                    }

                    // If there are too many encounters, fail
                    if (Object.keys(encounterTable).length >= configTable.maxEncounters) {
                        throw `Only ${configTable.maxEncounters} monster spawns allowed at a time`;
                    }

                    var transmogName = tokens[1];
                    tokens[1] = tokens[1].replace("@", "").toLowerCase();

                    if (tokens[1] === botConfig.twitchChannel) {
                        throw "You can't turn the broadcaster into a slime";
                    }

                    var slimeName = tokens[1].toLowerCase() + "_the_slime";
                    var monster = await Commands.spawnMonster("SLIME", slimeName, gameContext);
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

                    sendContextUpdate();

                    break;
                case "!untransmog":
                    if (context.username !== botConfig.twitchChannel && !context.mod) {
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

                    sendContextUpdate();

                    break;
                case "!explore":
                    // If there are too many encounters, fail
                    if (Object.keys(encounterTable).length >= configTable.maxEncounters) {
                        throw `All adventurers are busy with monsters right now.`;
                    }

                    var randomMonster = null;
                    var apCost = 5;
                    const maxRarity = Util.rollDice("1d100") < 10 ? 7 : 5;
                    const itemDrop = Util.rollDice("1d100") <= 20;

                    // Potential item drop
                    if (itemDrop) {
                        if (tokens.length >= 2) {
                            maxRarity *= 2;
                            apCost = 10;
                        }

                        const items = Object.keys(itemTable).filter(name => itemTable[name].rarity < maxRarity);
                        const foundItemKey = items[Util.randomNumber(items.length) - 1];
                        const foundItem = gameContext.itemTable[foundItemKey];

                        await Xhr.adjustPlayer(context.username, {ap: -apCost}, [foundItemKey]);

                        sendEvent({
                            type: "ITEM_GET",
                            targets: ["chat", "panel"],
                            eventData: {
                                results: {
                                    receiver: {
                                        name: context.username
                                    },
                                    item: foundItem,
                                    message: `${context.username} found ${foundItem.name}!`
                                },
                                encounterTable: gameContext.encounterTable
                            }
                        });
                        sendContextUpdate([caller], true);
                        return;
                    }

                    // Monster spawn
                    if (tokens.length < 2) {
                        var lowLevelMonsters = Object.keys(monsterTable).filter(name => monsterTable[name].rarity < maxRarity);
                        randomMonster = lowLevelMonsters[Util.randomNumber(lowLevelMonsters.length) - 1];
                    } else {
                        var dungeonMonsters = Object.keys(monsterTable).filter(name => monsterTable[name].rarity < maxRarity * 2 && monsterTable[name].dungeon === tokens[1]);
                        randomMonster = dungeonMonsters[Util.randomNumber(dungeonMonsters.length) - 1];
                        apCost = 10;
                    }

                    // Retrieve monster from monster table
                    var monsterName = randomMonster;
                    var monster = await Commands.spawnMonster(monsterName, null, gameContext);
                    encounterTable[monster.spawnKey] = monster;

                    // Expend AP
                    await Xhr.adjustPlayer(context.username, {ap: -apCost});

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

                    sendContextUpdate(null, true);

                    break;
                case "!spawn":
                    if (context.username !== botConfig.twitchChannel && !context.mod) {
                        throw "Only a broadcaster or mod can spawn monsters";
                    }

                    // If there are too many encounters, fail
                    if (Object.keys(encounterTable).length >= configTable.maxEncounters) {
                        throw `Only ${configTable.maxEncounters} monster spawns allowed at a time`;
                    }

                    var monster = null;
                    if (tokens.length < 2) {
                        // Retrieve a random monster from the present dungeon
                        const dungeonName = configTable.currentDungeon;

                        if (!dungeonName) {
                            throw "If no current dungeon is defined, then the spawn command requires a monster name."
                        }

                        const maxRarity = Util.rollDice("1d100") < 10 ? 7 : 5;
                        const dungeonMonsters = Object.keys(monsterTable).filter(name => monsterTable[name].rarity < maxRarity * 2 && monsterTable[name].dungeon === dungeonName);
                        const randomMonsterName = dungeonMonsters[Util.randomNumber(dungeonMonsters.length) - 1];
                        monster = await Commands.spawnMonster(randomMonsterName, null, gameContext);
                    } else {
                        // Retrieve monster from monster table
                        const monsterName = tokens[1];
                        monster = await Commands.spawnMonster(monsterName, null, gameContext);
                    }

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

                    sendContextUpdate();

                    break;
                case "!stats":
                    var username = context.username;
                    let buffs = Commands.createBuffMap(username, gameContext);
                    if (tokens[1]) {
                        username = tokens[1].replace("@", "").toLowerCase();
                    }

                    var user = await Xhr.getUser(username);
                    user = Util.expandUser(user, gameContext);
                    sendInfoToChat(`[${user.name}] HP: ${user.hp} -- AP: ${user.ap} -- STR: ${user.str} (${Util.sign(buffs.str)}) -- DEX: ${user.dex} (${Util.sign(buffs.dex)}) -- INT: ${user.int} (${Util.sign(buffs.int)}) -- HIT: ${user.hit} (${Util.sign(buffs.hit)}) -- AC: ${user.totalAC} (${Util.sign(buffs.ac)}) -- Cooldown: ${cooldownTable[username] * 5 || "0"} seconds.`);
                    break;
                case "!buffs":
                    var username = context.username;
                    var buffList = buffTable[username] || [];
                    sendInfoToChat(`[${username} Buffs] ${buffList.map(buff => `${buff.name}(${buff.duration * 5} seconds)`).join(", ")}.`);
                    break;
                case "!targets":
                    var activeUsers = await Xhr.getActiveUsers(gameContext);
                    var monsterList = Object.keys(encounterTable).map((name) => {
                        var monster = encounterTable[name];
                        if (monster.hp >= 0) {
                            return `${monster.name} (~${name})`;
                        }
                    });
                    sendInfoToChat(`Available targets are: ${[...activeUsers, ...monsterList]}`);
                    break;
                case "!give":
                    if (tokens.length < 3) {
                        throw "Must provide a target and an item id to give";
                    }

                    var itemId = tokens[1];
                    user = tokens[2].replace("@", "").toLowerCase();

                    var results = await Commands.giveItemFromInventory(context.username, user, itemId, gameContext);

                    sendEvent({
                        type: "ITEM_GIVE",
                        targets: ["chat"],
                        eventData: {
                            results,
                            encounterTable
                        }
                    });

                    sendContextUpdate([results.giver, results.receiver], true);

                    break;
                case "!gift":
                    if (tokens.length < 3) {
                        throw "Must provide a target and an item id to give";
                    }

                    var itemId = tokens[1];
                    user = tokens[2].replace("@", "").toLowerCase();

                    // Give from inventory if not a mod
                    if (context.username !== botConfig.twitchChannel && !context.mod) {
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
                    sendInfoToChat(`Visit https://deusprogrammer.com/util/twitch to see how to use our in chat battle system.`);
                    break;
                case "!inventory":
                case "!abilities":
                    sendInfoToChat(`${context.username} Visit https://deusprogrammer.com/util/twitch/battlers/${context.username} to view your inventory, abilities and stats.`);
                    break;
                // case "!refresh":
                //     if (context.username !== botConfig.twitchChannel && !context.mod) {
                //         throw "Only a mod or broadcaster can refresh the tables";
                //     }

                //     itemTable = await Xhr.getItemTable()
                //     jobTable = await Xhr.getJobTable();
                //     monsterTable = await Xhr.getMonsterTable();
                //     abilityTable = await Xhr.getAbilityTable();

                //     gameContext = { itemTable, jobTable, monsterTable, abilityTable, encounterTable, cooldownTable, buffTable,  chattersActive, configTable };

                //     sendInfoToChat("All tables refreshed");
                    
                //     break;
                case "!config":
                    if (context.username !== botConfig.twitchChannel && !context.mod) {
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
                    if (context.username !== botConfig.twitchChannel && !context.mod) {
                        throw "Only a mod or broadcaster can refresh the tables";
                    }

                    gameContext.encounterTable = {};
                    sendEvent({
                        type: "INFO",
                        targets: ["chat", "panel"],
                        eventData: {
                            results: {
                                message: "Clearing encounter table."
                            },
                            encounterTable
                        }
                    });
                    break;
                // case "!restart":
                //     if (context.username !== botConfig.twitchChannel && !context.mod) {
                //         throw "Only a mod or broadcaster can refresh the tables";
                //     }

                //     sendInfoToChat("Miku will be right back ^_-!.");
                //     setTimeout(() => {
                //         Util.restartProcess();
                //     }, 1000);
                //     break;
                // case "!shutdown":
                //     if (context.username !== botConfig.twitchChannel && !context.mod) {
                //         throw "Only a mod or broadcaster can refresh the tables";
                //     }

                //     sendInfoToChat("Miku going offline.  Oyasumi.");
                //     extWs.send(JSON.stringify({
                //         type: "SHUTDOWN",
                //         channelId: TWITCH_EXT_CHANNEL_ID,
                //         jwt: createJwt(botConfig.sharedSecretKey),
                //         to: "ALL",
                //     }));
                //     setTimeout(() => {
                //         process.exit(0);
                //     }, 5000);
                //     break;
                case "!about":
                    sendInfoToChat(`Chat battler dungeon version ${versionNumber} written by thetruekingofspace`);
                    break;
                case "!signup":
                    await Xhr.createUser({
                        username: caller.name,
                        userId: caller.id
                    });
                    sendInfoToChat(`${caller.name} created a battler.`);
                    break;
                default:
                    throw `${tokens[0]} is an invalid command.`;
            }
        } catch (e) {
            console.error(e.message + ": " + e.stack);
            sendErrorToChat(new Error(e));
            sendContextUpdate([caller]);
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

    gameContext = { itemTable, jobTable, monsterTable, abilityTable, encounterTable, cooldownTable, buffTable, chattersActive, configTable, dotTable, botConfig };

    console.log(`* All tables loaded`);

    // QUEUE CONSUMER
    setInterval(async () => {
        let message = queue.pop();

        if (message) {
            let event = message.event;
            let text = event.eventData ? event.eventData.results.message : "EXT MESSAGE";

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
                    client.say(botConfig.twitchChannel, text);
                } else {
                    client.say(botConfig.twitchChannel, "/me " + text);
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
                    sendInfoToChat(`${username} has stepped back into the shadows.`);
                }
            });

            // Tick down human cooldowns
            Object.keys(cooldownTable).forEach(async (username) => {
                cooldownTable[username] -= 1;
                if (cooldownTable[username] <= 0) {
                    delete cooldownTable[username];
                    sendInfoToChat(`${username} can act again.`);
                    let user = Xhr.getUser(username);
                    extWs.send(JSON.stringify({
                        type: "COOLDOWN_OVER",
                        channelId: TWITCH_EXT_CHANNEL_ID,
                        jwt: createJwt(botConfig.sharedSecretKey),
                        to: user.id,
                    }));
                }
            });

            // Tick down buff timers
            Object.keys(buffTable).forEach(async (username) => {
                var buffs = buffTable[username] || [];
                buffs.forEach((buff) => {
                    buff.duration--;

                    if (buff.duration <= 0) {
                        sendInfoToChat(`${username}'s ${buff.name} buff has worn off.`);
                    }
                });
                buffTable[username] = buffs.filter(buff => buff.duration > 0);

                // If not a monster, send buff updates to user
                if (!username.startsWith("~")) {
                    let user = await Xhr.getUser(username);
                    extWs.send(JSON.stringify({
                        type: "BUFF_UPDATE",
                        channelId: TWITCH_EXT_CHANNEL_ID,
                        jwt: createJwt(botConfig.sharedSecretKey),
                        to: user.id,
                        data: {
                            buffs: buffTable[username]
                        }
                    }));
                }
            });

            // Tick down status timers
            Object.keys(dotTable).forEach(async (username) => {
                var effects = dotTable[username];
                for (let effect of effects) {
                    effect.tickCounter--;
                    if (effect.tickCounter <= 0) {
                        effect.tickCounter = effect.ability.procTime;
                        effect.cycles--;

                        // Perform damage
                        let defender = null;
                        try {
                            defender = await Commands.getTarget(username, gameContext);
                            if (defender.hp <= 0) {
                                effect.cycles = 0;
                                continue;
                            }
                        } catch (e) {
                            effect.cycles = 0;
                            break;
                        }
                        let damageRoll = Util.rollDice(effect.ability.dmg);
                
                        if (!defender.isMonster) {
                            let user = await Xhr.getUser(username);
                            user[effect.ability.damageStat] -= damageRoll;
                            await Xhr.updateUser(user);

                            sendContextUpdate([user], true);
                        } else {
                            defender.hp -= damageRoll;
                        }

                        // Send panel update
                        sendEvent({
                            type: "ATTACKED",
                            targets: ["chat", "panel"],
                            eventData: {
                                results: {
                                    defender,
                                    message: `${defender.name} took ${damageRoll} damage from ${effect.ability.name} ${defender.hp <= 0 ? " and died." : "."}`
                                },
                                encounterTable
                            }
                        });

                        // Send update to all users if monster died.
                        if (defender.hp <= 0 && defender.isMonster) {
                            effect.cycles = 0;

                            delete gameContext.encounterTable[defender.spawnKey];

                            let itemGets = await Commands.distributeLoot(defender, gameContext);
                            itemGets.forEach((itemGet) => {
                                sendEvent(itemGet);
                            });

                            sendContextUpdate();
                            continue;
                        }

                        if (effect.cycles <= 0) {
                            sendInfoToChat(`${defender.name}'s ${effect.ability.name} status has worn off.`);
                            sendContextUpdate();
                        }
                    }
                }
                dotTable[username] = effects.filter(effect => effect.cycles > 0);

                // If not a monster, send effect updates to user
                if (!username.startsWith("~")) {
                    let user = await Xhr.getUser(username);
                    extWs.send(JSON.stringify({
                        type: "STATUS_UPDATE",
                        channelId: TWITCH_EXT_CHANNEL_ID,
                        jwt: createJwt(botConfig.sharedSecretKey),
                        to: user.id,
                        data: {
                            effects: dotTable[username]
                        }
                    }));
                }
            })


            // Do monster attacks
            Object.keys(encounterTable).forEach(async (encounterName) => {
                var encounter = encounterTable[encounterName];

                if (encounter.hp <= 0) {
                    return;
                }

                // If the monster has no tick, reset it.
                if (encounter.tick === undefined) {
                    var buffs = Commands.createBuffMap("~" + encounter.name, gameContext);
                    encounter.tick = Math.min(11, 6 - Math.min(5, encounter.dex + buffs.dex));
                }

                // If cooldown timer for monster is now zero, do an attack.
                if (encounter.tick === 0) {
                    var buffs = Commands.createBuffMap("~" + encounter.name, gameContext);
                    encounter.tick = Math.min(11, 6 - Math.min(5, encounter.dex + buffs.dex));

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

                        if (results.flags.hit) {
                            let message = `${results.attacker.name} hit ${results.defender.name} for ${results.damage} damage.`;
                            if (results.flags.crit) {
                                message = `${results.attacker.name} scored a critical hit on ${results.defender.name} for ${results.damage} damage.`;
                            }
                            sendEvent({
                                type: "ATTACK",
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
                                type: "ATTACK",
                                targets: ["chat", "panel"],
                                eventData: {
                                    results: {
                                        attacker: results.attacker,
                                        defender: results.defender,
                                        message: `${results.attacker.name} swung at ${results.defender.name} and missed.`
                                    },
                                    encounterTable
                                }
                            });
                        }

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

                        sendContextUpdate([results.defender]);
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
    // setInterval(async () => {
    //     sendInfoToChat("Visit https://deusprogrammer.com/util/twitch to see how to use our in chat battle system.");
    // }, 5 * 60 * 1000);

    // Announce restart
    sendInfoToChat(`Twitch Dungeon version ${versionNumber} is online.  All systems nominal.`);

    // Connect to websocket and begin keep alive
    connectWs(botConfig);

    // Start redemption listener
    await Redemption.startListener(queue, extWs, gameContext);
}

// MIKU'S HEART

const flaggedUsers = {};

const handleItemGive = async (item, giver, receiver) => {
    if (item.name.startsWith("Miku's")) {
        if (receiver.name !== "miku_the_space_bot") {
            client.say(botConfig.twitchChannel, `WHY ARE YOU TRADING THOSE?!  My ${item.name.replace("Miku's", "").toLowerCase()} aren't Pokemon cards >_<!`);
            flaggedUsers[receiver.name] = true;
            flaggedUsers[giver.name] = true;
        } else {
            let username = giver.name;
            let mikusThings = await gatherMikusThings(username);
            if (mikusThings.length > 0) {
                client.say(botConfig.twitchChannel, `Oh, ${username}...you're giving these back?  Hmmmmm...are you sure you don't have something else of mine...like my ${mikusThings.map(name => name.replace("Miku's", "").toLowerCase())[0]}.`);
            } else {
                client.say(botConfig.twitchChannel, `Oh, ${username}...you're giving these back?  Hmmmmm...I guess I forgive you...baka.`);
                flaggedUsers[giver.name] = false;
            }
        }
    } else if (item.type === "gift" && item.slot === "miku") {
        // Handle giving gifts to Miku
        client.whisper(giver.name, `Thanks for the ${item.name}...I'll remember this in the future.`);

        // TODO Create a luck table or something
    } else if (item.type === "sealed") {
        // Handle giving sealed item to Miku
        let sealedItem = await Xhr.getSealedItem(item.sealedItemId);

        if (sealedItem.owningChannel != TWITCH_EXT_CHANNEL_ID) {
            client.whisper(giver.name, `This sealed box is meant for another channel...you shouldn't have been able to get this.  Please contact deusprogrammer@gmail.com to let them know you have found a bug.`);
            return;
        }
        
        if (!sealedItem || sealedItem.claimed) {
            client.whisper(giver.name, `Huh...this box is empty.  That's weird.  Reach out to the streamer for assistance.`);
            return;
        }
        client.whisper(giver.name, `Congratulations!  You got a ${sealedItem.name}!  ${sealedItem.description}.  The code is: ${sealedItem.code}`);
        sealedItem.claimed = true;
        sealedItem.claimedBy = giver.name;
        await Xhr.updateSealedItem(sealedItem);
    }
}

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
        client.say(botConfig.twitchChannel, `W...wait!  Give back my ${event.eventData.results.item.name.replace("Miku's", "").toLowerCase()} >//<!`);
        flaggedUsers[event.eventData.results.receiver.name] = true;
    } else if (event.type === "ITEM_GIVE") {
        handleItemGive(event.eventData.results.item, event.eventData.results.giver, event.eventData.results.receiver);
    } else if (event.type === "ITEM_GIFT" && event.eventData.results.item.name.startsWith("Miku's")) {
        client.say(botConfig.twitchChannel, `WHERE DID YOU GET THOSE?!  I don't think I'm missing my ${event.eventData.results.item.name.replace("Miku's", "").toLowerCase()}...OMFG...WHERE DID THEY GO O//O;?`);
        flaggedUsers[event.eventData.results.receiver.name] = true;
        flaggedUsers[event.eventData.results.giver.name] = true;
    } else if (event.type === "JOIN") {
        let username = event.eventData.results.attacker.name;
        let mikusThings = await gatherMikusThings(username);
        if (mikusThings.length > 0) {
            client.say(botConfig.twitchChannel, `I see you still have my ${mikusThings.map(name => name.replace("Miku's", "").toLowerCase())[0]} and probably other things...hentai.`);
            flaggedUsers[username] = true;
        }
    }
}