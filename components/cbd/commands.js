const Xhr = require('../base/xhr');
const Util = require('../base/util');
const EventQueue = require('../base/eventQueue');

const TWITCH_EXT_CHANNEL_ID = process.env.TWITCH_EXT_CHANNEL_ID;

const createBuffMap = (username, context) => {
    let buffs = context.buffTable[username] || [];
    let buffMap = {
        str: 0,
        dex: 0,
        int: 0,
        hit: 0,
        ac: 0
    };

    buffs.forEach((buff) => {
        buff.changes.forEach((change) => {
            buffMap[change.stat.toLowerCase()] += change.amount;
        });
    })
    
    return buffMap;
}

const giveItem = async (giverName, username, itemId) => {
    let user = await Xhr.getUser(username);
    let item = await Xhr.getItem(itemId);

    if (!user) {
        throw `No user named ${username} found`;
    }

    if (!item) {
        throw `No item with item id ${itemId} found`;
    }

    await Xhr.giveItem(user, item.id);

    return {
        item,
        giver: {
            name: giverName
        },
        receiver: {
            name: username
        },
        message: `${giverName} gave ${username} a ${item.name}`
    }
}

const giveItemFromInventory = async (giverName, username, itemId) => {
    let giver = await Xhr.getUser(giverName);
    let user = await Xhr.getUser(username);
    let item = await Xhr.getItem(itemId);

    if (!giver) {
        throw `No user named ${username} found`;
    }

    if (!user && username !== "miku_the_space_bot") {
        throw `No user named ${username} found`;
    }

    if (!item) {
        throw `No item with item id ${itemId} found`;
    }

    let index = giver.inventory.indexOf(itemId);

    if (index < 0) {
        throw `${giverName} has no ${item.name} to give`;
    }

    await Xhr.removeItem(user, item.id);
    if (username !== "miku_the_space_bot") {
        await Xhr.giveItem(user, item.id);
    }

    return {
        item,
        giver,
        receiver: {
            name: username,
            id: user ? user.id : null
        },
        message: `${giverName} gave ${username} a ${item.name}`
    }
}

const getTarget = async (targetName, context) => {
    let target = {};
    if (targetName.startsWith("~")) {
        targetName = targetName.substring(1).toUpperCase();
        target = context.encounterTable[targetName];
        if (!target) {
            throw `${targetName} is not a valid monster`;
        }

        target.isMonster = true;
        target.equipment = {
            hand: {
                dmg: target.dmg || "1d6",
                dmgStat: target.dmgStat || "HP",
                toHitStat: target.toHitStat || "HIT",
                triggers: [],
                mods: {
                    hit: target.hit
                }
            }
        };
        target.totalAC = target.ac;
        target.encounterTableKey = targetName;
    } else {
        target = await Xhr.getUser(targetName);

        if (!target) {
            throw `@${targetName} doesn't have a battle avatar.`;
        }

        target.isMonster = false;
        target = Util.expandUser(target, context);
    }

    return target;
}

const distributeLoot = async (monster, context) => {
    let events = [];
    let drops = [...context.monsterTable[monster.id].drops.map((drop) => {return {...drop}})];
    let taken = {};
    for (var attacker in Util.shuffle(monster.aggro)) {
        for (var i in drops) {
            let drop = drops[i];

            let chanceRoll = Util.rollDice("1d100");
            console.log("CHANCE: " + chanceRoll + " vs " + drop.chance);
            if (chanceRoll < drop.chance && !(drop.exclusive && drop.exclusiveTaken)) {
                // If only one of these can drop for a given monster
                if (drop.onlyOne && taken[drop.itemId]) {
                    continue;
                }
                
                taken[drop.itemId] = true;
                await giveItem("", attacker, drop.itemId);

                // If exclusive, mark the drop as permanently taken
                if (drop.exclusive) {
                    // Skip exclusive loot drop if it belongs to another channel; this should never happen.
                    if (context.itemTable[drop.itemId].owningChannel != TWITCH_EXT_CHANNEL_ID) {
                        console.error(`Attempting to drop loot from channel ${context.itemTable[drop.itemId].owningChannel} in channel ${TWITCH_EXT_CHANNEL_ID}.`);
                        continue;
                    }

                    let updatedMonster = context.monsterTable[monster.id];

                    drop.exclusiveTaken  = true;
                    updatedMonster.drops = drops;
                    context.monsterTable[monster.id].drops = drops;
                    await Xhr.updateMonster(updatedMonster);
                }
                events.push({
                    type: "ITEM_GET",
                    targets: ["chat", "panel"],
                    eventData: {
                        results: {
                            receiver: attacker,
                            item: context.itemTable[drop.itemId],
                            message: `${attacker} found ${context.itemTable[drop.itemId].name}!`
                        },
                        encounterTable: context.encounterTable
                    }
                });
            }
        }
    }

    return events;
}

const hurt = async (attackerName, defenderName, ability, context, isTrigger = false, performTriggers = true) => {
    if (ability.element === "HEALING" || ability.element === "BUFFING") {
        throw `@${ability.name} is not an attack ability`;
    }

    let targets = await Xhr.getActiveUsers(context);

    let attacker = await getTarget(attackerName, context);

    if (attacker.hp <= 0) {
        throw `@${attackerName} is dead and cannot perform any actions.`;
    }

    if (!attacker.isMonster && attacker.ap < ability.ap) {
        throw `@${attackerName} needs ${ability.ap} to use ${ability.name}.`;
    }

    let defender = await getTarget(defenderName, context);

    if (defender && !targets.includes(defenderName) && !defender.isMonster) {
        throw `@${defenderName}'s not here man!`;
    }

    if (defender.hp <= 0) {
        throw `@${defenderName} is already dead.`;
    }

    // if (ability.target === "ENEMY" && !defender.isMonster) {
    //     throw `${ability.name} cannot target battlers`;
    // } else if (ability.target === "CHAT" && defender.isMonster) {
    //     throw `${ability.name} cannot target monsters`;
    // }

    let attackerBuffs = createBuffMap(attackerName, context);
    let defenderBuffs = createBuffMap(defenderName, context);


    // Find resistance
    let resistance = defender.resistances[ability.element.toLowerCase()];
    if (!resistance) {
        resistance = 0;
    }
    resistance = (100 - (resistance * 5))/100;

    let defenderAdjustments = {};
    let attackerAdjustments = {};

    let attackRoll = Util.rollDice("1d20");
    let modifiedAttackRoll = attackRoll + attacker[ability.toHitStat.toLowerCase()] + ability.mods[ability.toHitStat.toLowerCase()] + attackerBuffs[ability.toHitStat.toLowerCase()];
    let damageRoll = Util.rollDice(ability.dmg, defender[ability.dmgStat.toLowerCase()]);
    let modifiedDamageRoll = Math.ceil(Math.max(1, damageRoll + attacker.str + ability.mods.str + attackerBuffs.str) * resistance);
    let hit = true;
    let crit = false;
    let dead = false;
    let encounterTable = context.encounterTable;

    if (ability.ignoreDamageMods) {
        modifiedDamageRoll = damageRoll;
    }

    console.log(`ATTACK ROLL ${modifiedAttackRoll} (${attackRoll} + ${attacker[ability.toHitStat.toLowerCase()]} + ${ability.mods[ability.toHitStat.toLowerCase()]} + ${attackerBuffs[ability.toHitStat.toLowerCase()]}) vs AC ${defender.totalAC + defenderBuffs.ac} (${defender.totalAC} + ${defenderBuffs.ac})`);
    console.log(`DAMAGE ROLL ${modifiedDamageRoll} (${damageRoll} + ${attacker.str} + ${ability.mods.str} + ${attackerBuffs.str})`);

    if (attackRoll === 20 && !isTrigger) {
        modifiedDamageRoll *= 2.0;
        crit = true;
        message = `${attacker.name} ==> ${defender.name} -${modifiedDamageRoll}${ability.dmgStat}`;
    } else if (modifiedAttackRoll >= defender.totalAC + defenderBuffs.ac || isTrigger) {
        modifiedDamageRoll *= 1.0;
        message = `${attacker.name} ==> ${defender.name} -${modifiedDamageRoll}${ability.dmgStat}`;
    } else if (attackRoll === 1) {
        hit = false;
        message = `${attacker.name} ==> ${defender.name} MISS`;
    } else {
        modifiedDamageRoll = Math.ceil(modifiedDamageRoll * 0.5);
        message = `${attacker.name} ==> ${defender.name} -${modifiedDamageRoll}${ability.dmgStat}`;
    }

    if (hit && modifiedDamageRoll >= defender.hp && ability.dmgStat === "HP") {
        endStatus = `[DEAD]`;
        dead = true;
    } else {
        if (ability.dmgStat === "HP") {
            endStatus = `[${defender.hp - modifiedDamageRoll}/${defender.maxHp}HP]`;
        } else {
            endStatus = `[${defender.name} lost ${modifiedDamageRoll}${ability.dmgStat}]`;
        }
    }

    if (defender.isMonster) {
        if (!defender.aggro[attackerName]) {
            defender.aggro[attackerName] = 0;
        }
        defender.aggro[attackerName] += modifiedDamageRoll;
    }

    // Determine if proc damage occurs
    if (hit) {
        defenderAdjustments[ability.dmgStat.toLowerCase()] = -modifiedDamageRoll;

        // If this ability does DOT, then add an entry to the dotTable
        if (ability.procTime > 0 && !dead) {
            if (!context.dotTable[defenderName]) {
                context.dotTable[defenderName] = [];
            }

            // Check for existing effect
            let existingEffect = context.dotTable[defenderName].find(entry => entry.ability.id === ability.id);
            if (!existingEffect) {
                // Add new effect
                context.dotTable[defenderName].push({
                    ability, 
                    tickCounter: ability.procTime,
                    cycles: ability.maxProcs
                });
            } else {
                // Reset cycles left if already existing
                existingEffect.cycles = ability.maxProcs;
            }
        }
    }

    // Add ap adjustment
    attackerAdjustments.ap = -ability.ap;

    // Update attacker stats
    if (!attacker.isMonster) {
        console.log("ATTACKER ADJUSTMENTS: " + JSON.stringify(attackerAdjustments, null, 5));
        await Xhr.adjustStats(attacker, attackerAdjustments);
    }

    // Update defender stats
    if (!defender.isMonster && hit) {
        console.log("DEFENSE ADJUSTMENTS: " + JSON.stringify(defenderAdjustments, null, 5));
        await Xhr.adjustStats(defender, defenderAdjustments);
    } else if (defender.isMonster && hit) {
        console.log("DEFENSE ADJUSTMENTS: " + JSON.stringify(defenderAdjustments, null, 5));
        if (ability.dmgStat.toLowerCase() === "hp") {
            defender[ability.dmgStat.toLowerCase()] += defenderAdjustments[ability.dmgStat.toLowerCase()];
        }
    }

    // Send messages for damage dealing
    if (hit) {
        let damage = ability.ignoreDamageMods ? damageRoll : modifiedDamageRoll;
        let damageStat = ability.dmgStat;
        let damageSource = ability.name !== "attack" ? ability.name : attacker.name;
        let message = `${damageSource} dealt ${damage} ${damageStat} damage to ${defender.name}.`;
        if (crit) {
            message = `${damageSource} dealt ${damage} ${damageStat} critical damage to ${defender.name}.`;
        }

        await EventQueue.sendEvent({
            type: "ATTACKED",
            targets: ["chat", "panel"],
            eventData: {
                results: {
                    attacker: attacker,
                    defender: defender,
                    message
                },
                encounterTable
            }
        });

        // Display whether the enemy was weak to the element of the ability
        if (resistance > 1) {
            await EventQueue.sendEvent({
                type: "ATTACKED",
                targets: ["chat", "panel"],
                eventData: {
                    results: {
                        attacker: attacker,
                        defender: defender,
                        message: `${defender.name} is weak to ${ability.element.toLowerCase()}`
                    },
                    encounterTable
                }
            });
        } else if (resistance < 1) {
            await EventQueue.sendEvent({
                type: "ATTACKED",
                targets: ["chat", "panel"],
                eventData: {
                    results: {
                        attacker: attacker,
                        defender: defender,
                        message: `${defender.name} is resistant to ${ability.element.toLowerCase()}`
                    },
                    encounterTable
                }
            });
        }
    } else {
        await EventQueue.sendEvent({
            type: "ATTACKED",
            targets: ["chat", "panel"],
            eventData: {
                results: {
                    attacker: attacker,
                    defender: defender,
                    message: `${attacker.name} attacked ${defender.name} and missed.`
                },
                encounterTable
            }
        });
    }

    if (dead) {
        if (defender.isMonster) {
            if (defender.transmogName) {
                await EventQueue.sendInfoToChat(`/ban ${defender.transmogName}`);
            }

            delete encounterTable[defender.spawnKey];
            let itemGets = await distributeLoot(defender, context);

            itemGets.forEach(async (itemGet) => {
                await EventQueue.sendEvent(itemGet);
            });
        }

        await EventQueue.sendEvent({
            type: "DIED",
            targets: ["chat", "panel"],
            eventData: {
                results: {
                    defender: defender,
                    message: `${defender.name} was slain by ${attacker.name}.`
                },
                encounterTable
            }
        });
    }

    // Perform triggers
    let triggerResults = [];
    if (hit && !dead && performTriggers) {
        for (const trigger of ability.triggers) {
            let triggerRoll = Util.rollDice("1d20");
            let results = null;
            let ability = context.abilityTable[trigger.abilityId];
            trigger.ability = ability;
            await EventQueue.sendEvent({
                type: "INFO",
                targets: ["chat", "panel"],
                eventData: {
                    results: {
                        attacker: attacker,
                        defender: defender,
                        message: `${attacker.name}'s ${attacker.equipment.hand.name}'s ${trigger.ability.name} activated!`
                    },
                    encounterTable: context.encounterTable
                }
            });
            if (triggerRoll <= trigger.chance) {
                if (ability.element === "HEALING") {
                    results = await heal(attackerName, attackerName, ability, context);
                } else if (ability.element === "BUFFING") {
                    results = await buff(attackerName, defenderName, ability, context);
                } else {
                    results = await hurt(attackerName, defenderName, ability, context, true, true);
                }
            }
        }
    }

    return {
        message: `[BATTLE]: ${message}  ${hit ? endStatus : ''}`,
        damage: ability.ignoreDamageMods ? damageRoll : modifiedDamageRoll,
        damageStat: ability.dmgStat,
        flags: {
            crit,
            hit,
            dead
        },
        triggerResults,
        attacker,
        defender,
        damageType: ability.element
    }
}

const buff = async (attackerName, defenderName, ability, context) => {
    if (ability.element !== "BUFFING") {
        throw `@${ability.name} is not a buffing ability`;
    }

    let attacker = await getTarget(attackerName, context);

    if (attacker.hp <= 0) {
        throw `@${attackerName} is dead and cannot perform any actions.`;
    }

    if (!attacker.isMonster && attacker.ap < ability.ap) {
        throw `@${attackerName} needs ${ability.ap} to use ${ability.name}.`;
    }

    let defender = await getTarget(defenderName, context);

    // if (ability.target === "ENEMY" && !defender.isMonster) {
    //     throw `${ability.name} cannot target battlers`;
    // } else if (ability.target === "CHAT" && defender.isMonster) {
    //     throw `${ability.name} cannot target monsters`;
    // }

    let tokens  = ability.buffs.split(";");
    let changes = tokens.map((token) => {
        let groups = token.match(/(STR|DEX|INT|HIT|AC)\+*(\-*[0-9]+)(%*)/);

        if (!groups && groups.length < 3) {
            throw `Bad buff string on ability ${ability.name}`;
        }

        let amount = parseInt(groups[2]);
        if (groups[3] === "%") {
            amount = Math.ceil(defender[groups[1].toLowerCase()] * (amount/100));
        }

        return {
            stat: groups[1],
            amount
        }
    })

    // Combine with other buffs
    let existingBuffs = context.buffTable[defenderName] || [];
    let existingBuff = existingBuffs.find(buff => buff.id === ability.id);
    if (existingBuff) {
        console.log("User already has buff");
        existingBuff.duration = ability.buffsDuration;
    } else {
        existingBuffs.push(
            {
                id: ability.id,
                name: ability.name,
                duration: ability.buffsDuration,
                changes
            }
        );
    }
    context.buffTable[defenderName] = existingBuffs;

    // Adjust attacker ap if player
    if (!attacker.isMonster) {
        await Xhr.adjustStats(attacker, {ap: -ability.ap});
    }

    await EventQueue.sendEvent({
        type: "HEALING",
        targets: ["chat", "panel"],
        eventData: {
            results: {
                attacker,
                defender,
                message: `${defender.name} is affected by ${ability.name}`
            },
            encounterTable: context.encounterTable
        }
    });

    return {
        attacker,
        defender,
        flags: {
            crit: false,
            hit: false,
            dead: false
        },
        triggerResults: [],
        message: `${defender.name} is affected by ${ability.name}`,
        damage: 0,
        damageType: "BUFFING"
    }
}

const cleanse = async (attackerName, defenderName, ability, context) => {
    if (ability.element !== "CLEANSING") {
        throw `@${ability.name} is not a cleansing ability`;
    }

    let attacker = await getTarget(attackerName, context);

    if (attacker.hp <= 0) {
        throw `@${attackerName} is dead and cannot perform any actions.`;
    }

    // Check is user has enough ap
    if (!attacker.isMonster && attacker.ap < ability.ap) {
        throw `@${attackerName} needs ${ability.ap} to use ${ability.name}.`;
    }

    let defender = await getTarget(defenderName, context);

    // if (ability.target === "ENEMY" && !defender.isMonster) {
    //     throw `${ability.name} cannot target battlers`;
    // } else if (ability.target === "CHAT" && defender.isMonster) {
    //     throw `${ability.name} cannot target monsters`;
    // }

    let effectsRemoved = [];
    let tokens  = ability.buffs.split(";");
    tokens.forEach((token) => {
        let groups = token.match(/\-([a-zA-Z0-9_]+)/);

        if (!groups && groups.length < 2) {
            throw `Bad cleansing string on ability ${ability.name}`;
        }

        let effectToRemove = groups[1];
        effectsRemoved.push(effectToRemove.toLowerCase());

        let dots = context.dotTable[defenderName] || [];
        let buffs = context.buffTable[defenderName] || [];

        context.dotTable[defenderName] = dots.filter(dot => dot.ability.id !== effectToRemove);
        context.buffTable[defenderName] = buffs.filter(buff => buff.id === effectToRemove);
    })

    // Adjust attacker ap if player
    if (!attacker.isMonster) {
        await Xhr.adjustStats(attacker, {ap: -ability.ap});
    }

    let message = '';
    if (effectsRemoved.length < 1) {
        message = `${defender.name} wasn't cured of anything.`;
    } else if (effectsRemoved.length === 1) {
        message = `${defender.name} is cured of ${effectsRemoved[0]}`;
    } else if (effectsRemoved.length === 2) {
        message = `${defender.name} is cured of ${effectsRemoved[0]} and ${effectsRemoved[1]}`;
    } else {
        message = `${defender.name} is cured of ${effectsRemoved.slice(0, effectsRemoved.length - 1).join(", ")} and ${effectsRemoved[effectsRemoved.length - 1]}`;
    }

    await EventQueue.sendEvent({
        type: "HEALING",
        targets: ["chat", "panel"],
        eventData: {
            results: {
                attacker,
                defender,
                message
            },
            encounterTable: context.encounterTable
        }
    });
    
    return {
        attacker,
        defender,
        flags: {
            crit: false,
            hit: false,
            dead: false
        },
        triggerResults: [],
        message,
        damage: 0,
        damageType: "CLEANSING"
    }
}

const heal = async (attackerName, defenderName, ability, context) => {
    if (ability.element !== "HEALING") {
        throw `@${ability.name} is not a healing ability`;
    }

    let attacker = await getTarget(attackerName, context);

    if (attacker.hp <= 0) {
        throw `@${attackerName} is dead and cannot perform any actions.`;
    }

    if (!attacker.isMonster && attacker.ap < ability.ap) {
        throw `@${attackerName} needs ${ability.ap} to use ${ability.name}.`;
    }

    let defender = await getTarget(defenderName, context);

    // if (ability.target === "ENEMY" && !defender.isMonster) {
    //     throw `${ability.name} cannot target battlers`;
    // } else if (ability.target === "CHAT" && defender.isMonster) {
    //     throw `${ability.name} cannot target monsters`;
    // }

    let defenderAdjustments = {};
    let attackerAdjustments = {};
    let healingAmount = Math.max(1, Util.rollDice(ability.dmg));
    if (ability.dmgStat.toLowerCase === "hp") {
        let maxHeal = defender.maxHp - defender.hp;
        healingAmount = Math.min(maxHeal, healingAmount);
    }

    attackerAdjustments.ap = -ability.ap;
    defenderAdjustments[ability.dmgStat.toLowerCase()] = healingAmount;

    // Update attacker and target stats
    if (!attacker.isMonster) {
        console.log("ATTACKER ADJUSTMENTS: " + JSON.stringify(attackerAdjustments, null, 5));
        await Xhr.adjustStats(attacker, attackerAdjustments);
    }
    if (!defender.isMonster) {
        console.log("DEFENDER ADJUSTMENTS: " + JSON.stringify(defenderAdjustments, null, 5));
        await Xhr.adjustStats(defender, defenderAdjustments);
    } else {
        console.log("DEFENSE ADJUSTMENTS: " + JSON.stringify(defenderAdjustments, null, 5));
        if (ability.dmgStat.toLowerCase() === "hp") {
            defender[ability.dmgStat.toLowerCase()] += defenderAdjustments[ability.dmgStat.toLowerCase()];
        }
    }

    await EventQueue.sendEvent({
        type: "HEALING",
        targets: ["chat", "panel"],
        eventData: {
            results: {
                attacker,
                defender,
                message: `${ability.name} healed ${defender.name} for ${healingAmount} ${ability.dmgStat}`
            },
            encounterTable: context.encounterTable
        }
    });

    return {
        attacker,
        defender,
        flags: {
            crit: false,
            hit: false,
            dead: false
        },
        triggerResults: [],
        message: `${attacker.name} healed ${defender.name} for ${healingAmount} ${ability.dmgStat}`,
        damage: healingAmount,
        damageType: "HEALING"
    };
}

const attack = async (attackerName, defenderName, context) => {
    let attacker = await getTarget(attackerName, context);

    let weapon = attacker.equipment.hand;

    let results = await hurt(attackerName, defenderName, {
        name: "attack",
        dmg: weapon.dmg,
        dmgStat: weapon.dmgStat,
        toHitStat: weapon.toHitStat,
        ap: 1,
        ignoreDamageMods: false,
        target: "ANY",
        area: "ONE",
        triggers: weapon.triggers,
        element: "NONE",
        mods: {
            hit: 0,
            str: 0
        }
    }, context);

    return results;
}

const use = async (attackerName, defenderName, ability, pluginContext) => {
    let encounterTable = pluginContext.encounterTable;
    let targets = await Xhr.getActiveUsers(pluginContext);
    let aliveMonsters = Object.keys(encounterTable).map(monster => "~" + monster);

    let attacker = await getTarget(attackerName, pluginContext);

    if (!ability) {
        throw `Ability named ${ability.name} doesn't exist.`;
    }

    // Temporary patch until values are changed in UI and DB.
    if (ability.target === "CHAT") {
        ability.target = "FRIENDLY";
    }

    // TODO Determine if target is valid

    // Determine if command syntax is valid given the ability area.
    let abilityTargets = [];
    if (!defenderName) {
        if (ability.area === "ONE" && ability.target !== "FRIENDLY") {
            throw `${ability.name} cannot target all opponents.  You must specify a target.`;
        } else if (ability.area === "ONE" && ability.target === "FRIENDLY") {
            abilityTargets = [attackerName];
        } else if (ability.area == "ALL" && ability.target === "ENEMY") {
            if (!attacker.isMonster) {
                abilityTargets = aliveMonsters;
            } else {
                abilityTargets = targets;
            }
        } else if (ability.area == "ALL" && ability.target === "FRIENDLY") {
            if (!attacker.isMonster) {
                abilityTargets = targets;
            } else {
                abilityTargets = aliveMonsters;
            }
        } else {
            abilityTargets = [...targets, ...aliveMonsters];
        }
    } else {
        if (ability.area === "ALL") {
            throw `${ability.name} cannot target just one opponent.`;
        }

        abilityTargets = [defenderName];
    }

    // Perform ability on everyone
    for (let i in abilityTargets) {
        let abilityTarget = abilityTargets[i];

        let results = {};

        if (ability.element === "HEALING") {
            results = await heal(attackerName, abilityTarget, ability, pluginContext);
        } else if (ability.element === "BUFFING") {
            results = await buff(attackerName, abilityTarget, ability, pluginContext);
        } else if (ability.element === "CLEANSING") {
            results = await cleanse(attackerName, abilityTarget, ability, pluginContext);
        } else {
            results = await hurt(attackerName, abilityTarget, ability, pluginContext);
        }

        // // Announce results of attack
        // if (results.damageType === "HEALING") {
            
        // } else if (results.damageType === "BUFFING") {
            
        // } else if (results.damageType === "CLEANSING") {

        // } else if (
        //         results.damageType !== "HEALING" &&
        //         results.damageType !== "BUFFING" && 
        //         results.damageType !== "CLEANSING" && 
        //         results.flags.hit) {
            
        // } else if (
        //     results.damageType !== "HEALING" &&
        //     results.damageType !== "BUFFING" &&
        //     results.damageType !== "CLEANSING" && 
        //     !results.flags.hit
        // ) {

        // }

        // if (results.flags.dead) {

        // }
    }
}

const spawnMonster = async (monsterName, personalName, context) => {
    // Retrieve monster from monster table
    let monsterCopy = context.monsterTable[monsterName.toUpperCase()];

    if (!monsterCopy) {
        throw `${monsterName} is not a valid monster`;
    }

    // Make deep copy
    let monster = {...monsterCopy};
    monster.drops = monsterCopy.drops.filter((drop) => {
        return !drop.exclusiveTaken;
    }).map((drop) => {  
        return {...drop};
    });
    monster.actions = monsterCopy.actions.map((action) => {
        return {...action};
    })

    console.log("SPAWNED: " + JSON.stringify(monster, null, 5));

    // Set type here temporarily until we add to DB
    let type = monster.type || "MOB";
    let abbrev = "";
    switch (type) {
        case "MOB":
            abbrev = "M";
            break;
        case "ELITE":
            abbrev = "E";
            break;
        case "BOSS":
            abbrev = "B";
            break;
        case "RARE":
            abbrev = "R";
            break;
    }

    // Pick either the provided name or the default name
    var name = personalName || monster.name;

    // Copy monster into it's own object
    var index = 0;
    while (context.encounterTable[abbrev + (++index)]);
    let spawn = {
        ...monster,
        aggro: {},
        name,
        spawnKey: abbrev + index,
        maxHp: monster.hp,
        actionCooldown: Math.min(11, 6 - Math.min(5, monster.dex))
    };

    return spawn;
}

module.exports = {
    getTarget,
    createBuffMap,
    distributeLoot,
    use,
    attack,
    heal,
    buff,
    hurt,
    cleanse,
    spawnMonster,
    giveItem,
    giveItemFromInventory
}