const Util = require('../util');
const Xhr = require('../xhr');
const Commands = require('../commands');

module.exports = {
    "!ready": async (twitchContext, gameContext, eventUtil) => {
        if (!gameContext.botConfig.config.cbd) {
            throw "This channel does not have this command enabled";
        }

        if (!gameContext.chattersActive[twitchContext.username]) {
            gameContext.chattersActive[twitchContext.username] = 10 * 12;
            eventUtil.sendEvent({
                type: "JOIN",
                targets: ["chat", "panel"],
                eventData: {
                    results: {
                        attacker: {
                            name: twitchContext.username
                        },
                        message: `${twitchContext.username} joins the brawl!`
                    },
                    encounterTable: gameContext.encounterTable
                }
            });
        }

        eventUtil.sendContextUpdate();
    },
    "!use": async (twitchContext, gameContext, eventUtil) => {
        if (!gameContext.botConfig.config.cbd) {
            throw "This channel does not have this command enabled";
        }

        if (twitchContext.tokens.length < 2) {
            throw "You must have an name for your ability.";
        }

        if (gameContext.cooldownTable[twitchContext.username]) {
            throw `${twitchContext.username} is on cooldown.`;
        }

        // Set user active if they attack
        if (!gameContext.chattersActive[twitchContext.username]) {
            gameContext.chattersActive[twitchContext.username] = 10 * 12;
            eventUtil.sendEvent({
                type: "JOIN",
                targets: ["chat", "panel"],
                eventData: {
                    results: {
                        attacker: {
                            name: twitchContext.username
                        },
                        message: `${twitchContext.username} joins the brawl!`
                    },
                    encounterTable: gameContext.encounterTable
                }
            });
        }

        var isItem = false;
        var itemName = "";
        var foundIndex = -1;
        var attackerName = twitchContext.username;
        var abilityName = twitchContext.tokens[1].toUpperCase();
        var defenderName = twitchContext.tokens[2] ? twitchContext.tokens[2].replace("@", "").toLowerCase() : null;
        var attacker = await Commands.getTarget(attackerName, gameContext);
        var targets = await Xhr.getActiveUsers(gameContext);
        var aliveMonsters = Object.keys(gameContext.encounterTable).map(monster => "~" + monster);

        if (abilityName.startsWith("#")) {
            itemName = abilityName.substring(1).toUpperCase();
            var item = gameContext.itemTable[itemName];
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

        var ability = gameContext.abilityTable[abilityName];

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
            eventUtil.sendEvent({
                type: "INFO",
                targets: ["chat", "panel"],
                eventData: {
                    results: {
                        attacker,
                        message: `${attacker.name} uses ${ability.name}`
                    },
                    encounterTable: gameContext.encounterTable
                }
            });
        } else {
            eventUtil.sendEvent({
                type: "INFO",
                targets: ["chat", "panel"],
                eventData: {
                    results: {
                        attacker,
                        message: `${attacker.name} uses a ${itemName}`
                    },
                    encounterTable: gameContext.encounterTable
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
                eventUtil.sendEvent({
                    type: "HEALING",
                    targets: ["chat", "panel"],
                    eventData: {
                        results: {
                            attacker: results.attacker,
                            defender: results.defender,
                            message: results.message
                        },
                        encounterTable: gameContext.encounterTable
                    }
                });
            } else if (results.damageType === "BUFFING") {
                eventUtil.sendEvent({
                    type: "BUFFING",
                    targets: ["chat", "panel"],
                    eventData: {
                        results: {
                            attacker: results.attacker,
                            defender: results.defender,
                            message: results.message
                        },
                        encounterTable: gameContext.encounterTable
                    }
                });
            } else if (results.damageType === "CLEANSING") {
                eventUtil.sendEvent({
                    type: "BUFFING",
                    targets: ["chat", "panel"],
                    eventData: {
                        results: {
                            attacker: results.attacker,
                            defender: results.defender,
                            message: results.message
                        },
                        encounterTable: gameContext.encounterTable
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

                eventUtil.sendEvent({
                    type: "ATTACKED",
                    targets: ["chat", "panel"],
                    eventData: {
                        results: {
                            attacker: results.attacker,
                            defender: results.defender,
                            message
                        },
                        encounterTable: gameContext.encounterTable
                    }
                });
            } else if (
                results.damageType !== "HEALING" &&
                results.damageType !== "BUFFING" &&
                results.damageType !== "CLEANSING" && 
                !results.flags.hit
            ) {
                eventUtil.sendEvent({
                    type: "ATTACKED",
                    targets: ["chat", "panel"],
                    eventData: {
                        results: {
                            attacker: results.attacker,
                            defender: results.defender,
                            message: `${results.attacker.name} used ${ability.name} on ${results.defender.name} and missed.`
                        },
                        encounterTable: gameContext.encounterTable
                    }
                });
            }

            // Show trigger results
            for (const triggerResult of results.triggerResults) {
                eventUtil.sendEvent({
                    type: "INFO",
                    targets: ["chat", "panel"],
                    eventData: {
                        results: {
                            attacker: triggerResult.results.attacker,
                            defender: triggerResult.results.defender,
                            message: `${results.attacker.name} triggered ${triggerResult.trigger.ability.name}!`
                        },
                        encounterTable: gameContext.encounterTable
                    }
                });
            }

            if (results.flags.dead) {
                if (results.defender.isMonster) {
                    if (results.defender.transmogName) {
                        client.say(gameContext.botConfig.twitchChannel, `/ban ${results.defender.transmogName}`);
                    }

                    delete gameContext.encounterTable[results.defender.spawnKey];
                    var itemGets = await Commands.distributeLoot(results.defender, gameContext);

                    itemGets.forEach((itemGet) => {
                        eventUtil.sendEvent(itemGet);
                    })
                }
                
                eventUtil.sendEvent({
                    type: "DIED",
                    targets: ["chat", "panel"],
                    eventData: {
                        results: {
                            defender: results.defender,
                            message: `${results.defender.name} was slain by ${results.attacker.name}.`
                        },
                        encounterTable: gameContext.encounterTable
                    }
                });

                eventUtil.sendContextUpdate();
            }
        }

        // Get basic user to update
        var updatedAttacker = await Xhr.getUser(twitchContext.username);

        // Update ap
        updatedAttacker.ap -= ability.ap;

        // If item, remove from inventory
        if (isItem) {
            foundIndex = updatedAttacker.inventory.findIndex(name => name === itemName);
            updatedAttacker.inventory.splice(foundIndex, 1);
        }

        // Get basic user to update
        await Xhr.updateUser(updatedAttacker);

        eventUtil.sendContextUpdate([updatedAttacker], true);

        // Set user cool down
        var currBuffs = Commands.createBuffMap(twitchContext.username, gameContext);
        gameContext.cooldownTable[twitchContext.username] = Math.min(11, 6 - Math.min(5, attacker.dex + currBuffs.dex));

    },
    "!attack": async (twitchContext, gameContext, eventUtil) => {
        if (!gameContext.botConfig.config.cbd) {
            throw "This channel does not have this command enabled";
        }

        if (twitchContext.tokens.length < 2) {
            throw "You must have a target for your attack.";
        }
        var attacker = await Commands.getTarget(twitchContext.username, gameContext);
        var defenderName = twitchContext.tokens[1].replace("@", "").toLowerCase();

        if (gameContext.cooldownTable[twitchContext.username]) {
            throw `${twitchContext.username} is on cooldown.`;
        }

        var results = await Commands.attack(twitchContext.username, defenderName, gameContext);

        // Set user cool down
        var currBuffs = Commands.createBuffMap(twitchContext.username, gameContext);
        gameContext.cooldownTable[twitchContext.username] = Math.min(11, 6 - Math.min(5, attacker.dex + currBuffs.dex));

        // Set user active if they attack
        if (!gameContext.chattersActive[twitchContext.username]) {
            gameContext.chattersActive[twitchContext.username] = 10 * 12;
            eventUtil.sendEvent({
                type: "JOIN",
                targets: ["chat", "panel"],
                eventData: {
                    results: {
                        attacker: {
                            name: twitchContext.username
                        },
                        message: `${twitchContext.username} joins the brawl!`
                    },
                    encounterTable: gameContext.encounterTable
                }
            });
        }

        if (results.flags.hit) {
            let message = `${results.attacker.name} hit ${results.defender.name} for ${results.damage} ${results.damageStat} damage.`;
            if (results.flags.crit) {
                message = `${results.attacker.name} scored a critical hit on ${results.defender.name} for ${results.damage} ${results.damageStat} damage.`;
            }

            eventUtil.sendEvent({
                type: "ATTACKED",
                targets: ["chat", "panel"],
                eventData: {
                    results: {
                        attacker: results.attacker,
                        defender: results.defender,
                        message
                    },
                    encounterTable: gameContext.encounterTable
                }
            });
        } else {
            eventUtil.sendEvent({
                type: "ATTACKED",
                targets: ["chat", "panel"],
                eventData: {
                    results: {
                        attacker: results.attacker,
                        defender: results.defender,
                        message: `${results.attacker.name} attacked ${results.defender.name} and missed.`
                    },
                    encounterTable: gameContext.encounterTable
                }
            });
        }

        // Show trigger results
        for (const triggerResult of results.triggerResults) {
            eventUtil.sendEvent({
                type: "INFO",
                targets: ["chat", "panel"],
                eventData: {
                    results: {
                        attacker: triggerResult.results.attacker,
                        defender: triggerResult.results.defender,
                        message: `${results.attacker.name}'s ${results.attacker.equipment.hand.name}'s ${triggerResult.trigger.ability.name} activated!`
                    },
                    encounterTable: gameContext.encounterTable
                }
            });
        }

        if (results.flags.dead) {
            if (results.defender.isMonster) {
                if (results.defender.transmogName) {
                    client.say(gameContext.botConfig.twitchChannel, `/ban ${results.defender.transmogName}`);
                }

                delete gameContext.encounterTable[results.defender.spawnKey];
                var itemGets = await Commands.distributeLoot(results.defender, gameContext);

                itemGets.forEach((itemGet) => {
                    eventUtil.sendEvent(itemGet);
                });

                eventUtil.sendContextUpdate();
            }

            eventUtil.sendEvent({
                type: "DIED",
                targets: ["chat", "panel"],
                eventData: {
                    results: {
                        defender: results.defender,
                        message: `${results.defender.name} was slain by ${results.attacker.name}.`
                    },
                    encounterTable: gameContext.encounterTable
                }
            });
        }

        eventUtil.sendContextUpdate([results.attacker, results.defender], true);

    },
    "!transmog": async (twitchContext, gameContext, eventUtil) => {
        if (!gameContext.botConfig.config.cbd) {
            throw "This channel does not have this command enabled";
        }

        if (twitchContext.username !== gameContext.botConfig.twitchChannel && !twitchContext.mod) {
            throw "Only a broadcaster or mod can turn a viewer into a slime";
        }

        if (twitchContext.tokens.length < 2) {
            throw "You must specify a target to turn into a slime";
        }

        // If there are too many encounters, fail
        if (Object.keys(gameContext.encounterTable).length >= gameContext.configTable.maxEncounters) {
            throw `Only ${gameContext.configTable.maxEncounters} monster spawns allowed at a time`;
        }

        var transmogName = twitchContext.tokens[1];
        twitchContext.tokens[1] = twitchContext.tokens[1].replace("@", "").toLowerCase();

        if (twitchContext.tokens[1] === gameContext.botConfig.twitchChannel) {
            throw "You can't turn the broadcaster into a slime";
        }

        var slimeName = twitchContext.tokens[1].toLowerCase() + "_the_slime";
        var monster = await Commands.spawnMonster("SLIME", slimeName, gameContext);
        monster.transmogName = transmogName;
        gameContext.encounterTable[monster.spawnKey] = monster;

        eventUtil.sendEvent({
            type: "SPAWN",
            targets: ["chat", "panel"],
            eventData: {
                results: {
                    message: `${twitchContext.tokens[1]} was turned into a slime and will be banned upon death.  Target name: ~${monster.spawnKey}.`
                },
                encounterTable: gameContext.encounterTable
            }
        });

        eventUtil.sendContextUpdate();

    },
    "!untransmog": async (twitchContext, gameContext, eventUtil) => {
        if (!gameContext.botConfig.config.cbd) {
            throw "This channel does not have this command enabled";
        }

        if (twitchContext.username !== gameContext.botConfig.twitchChannel && !twitchContext.mod) {
            throw "Only a broadcaster or mod can revert a slime";
        }

        if (twitchContext.tokens.length < 2) {
            throw "You must specify a target to revert from a slime";
        }

        twitchContext.tokens[1] = twitchContext.tokens[1].replace("@", "").toLowerCase();

        var monsterName = twitchContext.tokens[1].toLowerCase() + "_the_slime";

        if (!gameContext.encounterTable[monsterName]) {
            throw `${twitchContext.tokens[1]} isn't a slime`;
        }

        delete gameContext.encounterTable[monsterName];

        eventUtil.sendContextUpdate();
    },
    "!explore": async (twitchContext, gameContext, eventUtil) => {
        if (!gameContext.botConfig.config.cbd) {
            throw "This channel does not have this command enabled";
        }

        // If there are too many encounters, fail
        if (Object.keys(gameContext.encounterTable).length >= gameContext.configTable.maxEncounters) {
            throw `All adventurers are busy with monsters right now.`;
        }

        var randomMonster = null;
        var apCost = 5;
        const maxRarity = Util.rollDice("1d100") < 10 ? 7 : 5;
        const itemDrop = Util.rollDice("1d100") <= 20;

        // Potential item drop
        if (itemDrop) {
            if (twitchContext.tokens.length >= 2) {
                maxRarity *= 2;
                apCost = 10;
            }

            const items = Object.keys(gameContext.itemTable).filter(name => gameContext.itemTable[name].rarity < maxRarity);
            const foundItemKey = items[Util.randomNumber(items.length) - 1];
            const foundItem = gameContext.itemTable[foundItemKey];

            await Xhr.adjustPlayer(twitchContext.username, {ap: -apCost}, [foundItemKey]);

            eventUtil.sendEvent({
                type: "ITEM_GET",
                targets: ["chat", "panel"],
                eventData: {
                    results: {
                        receiver: {
                            name: twitchContext.username
                        },
                        item: foundItem,
                        message: `${twitchContext.username} found ${foundItem.name}!`
                    },
                    encounterTable: gameContext.encounterTable
                }
            });
            eventUtil.sendContextUpdate([twitchContext.caller], true);
            return;
        }

        // Monster spawn
        if (twitchContext.tokens.length < 2) {
            var lowLevelMonsters = Object.keys(gameContext.monsterTable).filter(name => gameContext.monsterTable[name].rarity < maxRarity);
            randomMonster = lowLevelMonsters[Util.randomNumber(lowLevelMonsters.length) - 1];
        } else {
            var dungeonMonsters = Object.keys(gameContext.monsterTable).filter(name => gameContext.monsterTable[name].rarity < maxRarity * 2 && gameContext.monsterTable[name].dungeon === twitchContext.tokens[1]);
            randomMonster = dungeonMonsters[Util.randomNumber(dungeonMonsters.length) - 1];
            apCost = 10;
        }

        // Retrieve monster from monster table
        var monsterName = randomMonster;
        var monster = await Commands.spawnMonster(monsterName, null, gameContext);
        gameContext.encounterTable[monster.spawnKey] = monster;

        // Expend AP
        await Xhr.adjustPlayer(twitchContext.username, {ap: -apCost});

        eventUtil.sendEvent({
            type: "SPAWN",
            targets: ["chat", "panel"],
            eventData: {
                results: {
                    message: `${monster.name} has appeared!  Target name: ~${monster.spawnKey}.`
                },
                encounterTable: gameContext.encounterTable
            }
        });

        eventUtil.sendContextUpdate(null, true);
    },
    "!spawn": async (twitchContext, gameContext, eventUtil) => {
        if (!gameContext.botConfig.config.cbd) {
            throw "This channel does not have this command enabled";
        }

        if (twitchContext.username !== gameContext.botConfig.twitchChannel && !twitchContext.mod) {
            throw "Only a broadcaster or mod can spawn monsters";
        }

        // If there are too many encounters, fail
        if (Object.keys(gameContext.encounterTable).length >= gameContext.configTable.maxEncounters) {
            throw `Only ${gameContext.configTable.maxEncounters} monster spawns allowed at a time`;
        }

        var monster = null;
        if (twitchContext.tokens.length < 2) {
            // Retrieve a random monster from the present dungeon
            const dungeonName = gameContext.configTable.currentDungeon;

            if (!dungeonName) {
                throw "If no current dungeon is defined, then the spawn command requires a monster name."
            }

            const maxRarity = Util.rollDice("1d100") < 10 ? 7 : 5;
            const dungeonMonsters = Object.keys(gameContext.monsterTable).filter(name => gameContext.monsterTable[name].rarity < maxRarity * 2 && gameContext.monsterTable[name].dungeon === dungeonName);
            const randomMonsterName = dungeonMonsters[Util.randomNumber(dungeonMonsters.length) - 1];
            monster = await Commands.spawnMonster(randomMonsterName, null, gameContext);
        } else {
            // Retrieve monster from monster table
            const monsterName = twitchContext.tokens[1];
            monster = await Commands.spawnMonster(monsterName, null, gameContext);
        }

        gameContext.encounterTable[monster.spawnKey] = monster;

        eventUtil.sendEvent({
            type: "SPAWN",
            targets: ["chat", "panel"],
            eventData: {
                results: {
                    message: `${monster.name} has appeared!  Target name: ~${monster.spawnKey}.`
                },
                encounterTable: gameContext.encounterTable
            }
        });

        eventUtil.sendContextUpdate();

    },
    "!stats": async (twitchContext, gameContext, eventUtil) => {
        if (!gameContext.botConfig.config.cbd) {
            throw "This channel does not have this command enabled";
        }

        var username = twitchContext.username;
        let buffs = Commands.createBuffMap(username, gameContext);
        if (twitchContext.tokens[1]) {
            username = twitchContext.tokens[1].replace("@", "").toLowerCase();
        }

        var user = await Xhr.getUser(username);
        user = Util.expandUser(user, gameContext);
        eventUtil.sendInfoToChat(`[${user.name}] HP: ${user.hp} -- AP: ${user.ap} -- STR: ${user.str} (${Util.sign(buffs.str)}) -- DEX: ${user.dex} (${Util.sign(buffs.dex)}) -- INT: ${user.int} (${Util.sign(buffs.int)}) -- HIT: ${user.hit} (${Util.sign(buffs.hit)}) -- AC: ${user.totalAC} (${Util.sign(buffs.ac)}) -- Cooldown: ${gameContext.cooldownTable[username] * 5 || "0"} seconds.`);
    },
    "!buffs": async (twitchContext, gameContext, eventUtil) => {
        if (!gameContext.botConfig.config.cbd) {
            throw "This channel does not have this command enabled";
        }

        var username = twitchContext.username;
        var buffList = gameContext.buffTable[username] || [];
        eventUtil.sendInfoToChat(`[${username} Buffs] ${buffList.map(buff => `${buff.name}(${buff.duration * 5} seconds)`).join(", ")}.`);
    },
    "!targets": async (twitchContext, gameContext, eventUtil) => {
        if (!gameContext.botConfig.config.cbd) {
            throw "This channel does not have this command enabled";
        }

        var activeUsers = await Xhr.getActiveUsers(gameContext);
        var monsterList = Object.keys(gameContext.encounterTable).map((name) => {
            var monster = gameContext.encounterTable[name];
            if (monster.hp >= 0) {
                return `${monster.name} (~${name})`;
            }
        });
        eventUtil.sendInfoToChat(`Available targets are: ${[...activeUsers, ...monsterList]}`);
    },
    "!give": async (twitchContext, gameContext, eventUtil) => {
        if (!gameContext.botConfig.config.cbd) {
            throw "This channel does not have this command enabled";
        }

        if (twitchContext.tokens.length < 3) {
            throw "Must provide a target and an item id to give";
        }

        var itemId = twitchContext.tokens[1];
        user = twitchContext.tokens[2].replace("@", "").toLowerCase();

        var results = await Commands.giveItemFromInventory(twitchContext.username, user, itemId, gameContext);

        eventUtil.sendEvent({
            type: "ITEM_GIVE",
            targets: ["chat"],
            eventData: {
                results,
                encounterTable: gameContext.encounterTable
            }
        });

        eventUtil.sendContextUpdate([results.giver, results.receiver], true);
    },
    "!gift": async (twitchContext, gameContext, eventUtil) => {
        if (!gameContext.botConfig.config.cbd) {
            throw "This channel does not have this command enabled";
        }

        if (twitchContext.tokens.length < 3) {
            throw "Must provide a target and an item id to give";
        }

        var itemId = twitchContext.tokens[1];
        user = twitchContext.tokens[2].replace("@", "").toLowerCase();

        // Give from inventory if not a mod
        if (twitchContext.username !== gameContext.botConfig.twitchChannel && !twitchContext.mod) {
            throw "Only a mod can gift an item to someone";
        }

        // Give as mod
        var results = await Commands.giveItem(twitchContext.username, user, itemId, target);

        eventUtil.sendEvent({
            type: "ITEM_GIFT",
            targets: ["chat"],
            eventData: {
                results,
                encounterTable: gameContext.encounterTable
            }
        });
    },
    "!reset": async (twitchContext, gameContext, eventUtil) => {
        if (!gameContext.botConfig.config.cbd) {
            throw "This channel does not have this command enabled";
        }

        if (twitchContext.username !== gameContext.botConfig.twitchChannel && !twitchContext.mod) {
            throw "Only a mod or broadcaster can refresh the tables";
        }

        gameContext.encounterTable = {};
        eventUtil.sendEvent({
            type: "INFO",
            targets: ["chat", "panel"],
            eventData: {
                results: {
                    message: "Clearing encounter table."
                },
                encounterTable: gameContext.encounterTable
            }
        });
    }
}