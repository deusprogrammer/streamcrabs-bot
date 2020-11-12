var Xhr = require('./xhr');
var Util = require('./util');

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

    user.inventory.push(itemId);
    await Xhr.updateUser(user);

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

    giver.inventory.splice(index, 1);
    if (username !== "miku_the_space_bot") {
        user.inventory.push(itemId);
    }

    await Xhr.updateUser(giver);
    if (username !== "miku_the_space_bot") {
        await Xhr.updateUser(user);
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
                    console.log("ONLY ONE");
                    continue;
                }
                
                taken[drop.itemId] = true;
                await giveItem("", attacker, drop.itemId);

                // If exclusive, mark the drop as permanently taken
                if (drop.exclusive) {
                    console.log("EXCLUSIVE");
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

    let defender = await getTarget(defenderName, context);

    if (defender && !targets.includes(defenderName) && !defender.isMonster) {
        throw `@${defenderName}'s not here man!`;
    }

    if (defender.hp <= 0) {
        throw `@${defenderName} is already dead.`;
    }

    if (ability.target === "ENEMY" && !defender.isMonster) {
        throw `${ability.name} cannot target battlers`;
    } else if (ability.target === "CHAT" && defender.isMonster) {
        throw `${ability.name} cannot target monsters`;
    }

    let attackerBuffs = createBuffMap(attackerName, context);
    let defenderBuffs = createBuffMap(defenderName, context);

    let attackRoll = Util.rollDice("1d20");
    let modifiedAttackRoll = attackRoll + attacker[ability.toHitStat.toLowerCase()] + ability.mods[ability.toHitStat.toLowerCase()] + attackerBuffs[ability.toHitStat.toLowerCase()];
    let damageRoll = Util.rollDice(ability.dmg, defender[ability.dmgStat.toLowerCase()]);
    let modifiedDamageRoll = Math.max(1, damageRoll + attacker.str + ability.mods.str + attackerBuffs.str);
    let hit = true;
    let crit = false;
    let dead = false;

    if (ability.ignoreDamageMods) {
        modifiedDamageRoll = damageRoll;
    }

    console.log(`ATTACK ROLL ${modifiedAttackRoll} (${attackRoll} + ${attacker[ability.toHitStat.toLowerCase()]} + ${ability.mods[ability.toHitStat.toLowerCase()]} + ${attackerBuffs[ability.toHitStat.toLowerCase()]}) vs AC ${defender.totalAC + defenderBuffs.ac} (${defender.totalAC} + ${defenderBuffs.ac})`);
    console.log(`DAMAGE ROLL ${modifiedDamageRoll} (${damageRoll} + ${attacker.str} + ${ability.mods.str} + ${attackerBuffs.str})`);

    if (attackRoll === 20 && !isTrigger) {
        modifiedDamageRoll *= 2;
        crit = true;
        message = `${attacker.name} ==> ${defender.name} -${modifiedDamageRoll}${ability.dmgStat}`;
        console.log("CRIT");
    } else if (modifiedAttackRoll >= defender.totalAC + defenderBuffs.ac || isTrigger) {
        message = `${attacker.name} ==> ${defender.name} -${modifiedDamageRoll}${ability.dmgStat}`;
        console.log("HIT");
    } else {
        message = `${attacker.name} ==> ${defender.name} MISS`;
        hit = false;
        console.log("MISS");
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

    // TODO Test this once Twitch finishes dragging their heels on testing my extension.
    // Simplified adjustments
    // const defenderChanges = {};

    // if (hit) {
    //     defenderChanges[ability.dmgStat.toLowerCase()] = -modifiedDamageRoll;
    //     if (ability.ignoreDamageMods) {
    //         defenderChanges[ability.dmgStat.toLowerCase()] = -damageRoll;
    //     }

    //     // If this ability does DOT, then add an entry to the dotTable
    //     if (ability.procTime > 0 && !dead) {
    //         if (!context.dotTable[defenderName]) {
    //             context.dotTable[defenderName] = [];
    //         }

    //         // Check for existing effect
    //         let existingEffect = context.dotTable[defenderName].find(entry => entry.ability.id === ability.id);
    //         if (!existingEffect) {
    //             // Add new effect
    //             context.dotTable[defenderName].push({
    //                 ability, 
    //                 tickCounter: ability.procTime,
    //                 cycles: ability.maxProcs
    //             });
    //         } else {
    //             // Reset cycles left if already existing
    //             existingEffect.cycles = ability.maxProcs;
    //         }
    //     }
    // }

    // Xhr.adjustPlayer(defender.name, defenderChanges, null, null, context);

    // // Set aggro
    // if (defender.isMonster) {
    //     if (!defender.aggro[attackerName]) {
    //         defender.aggro[attackerName] = 0;
    //     }
    //     defender.aggro[attackerName] += modifiedDamageRoll;
    // }

    // Get current, unexpanded version
    if (!attacker.isMonster) {
        attacker = await Xhr.getUser(attacker.name);
    }
    if (!defender.isMonster) {
        defender = await Xhr.getUser(defender.name);
    } else {
        if (!defender.aggro[attackerName]) {
            defender.aggro[attackerName] = 0;
        }
        defender.aggro[attackerName] += modifiedDamageRoll;
    }

    if (hit) {
        defender[ability.dmgStat.toLowerCase()] -= modifiedDamageRoll;

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

    // Update attacker and target stats
    if (!attacker.isMonster) {
        await Xhr.updateUser(attacker);
        attacker = Util.expandUser(attacker, context);
    }
    if (!defender.isMonster && hit) {
        await Xhr.updateUser(defender);
        defender = Util.expandUser(defender, context);
    }

    // Perform triggers
    let triggerResults = [];
    if (hit && !dead && performTriggers) {
        for (const trigger of ability.triggers) {
            let triggerRoll = Util.rollDice("1d20");
            let results = null;
            let ability = context.abilityTable[trigger.abilityId];
            trigger.ability = ability;
            if (triggerRoll <= trigger.chance) {
                if (ability.element === "HEALING") {
                    results = await heal(attackerName, attackerName, ability, context);
                } else if (ability.element === "BUFFING") {
                    results = await buff(attackerName, defenderName, ability, context);
                } else {
                    results = await hurt(attackerName, defenderName, ability, context, true, false);
                }
                triggerResults.push({trigger, results});
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

    let defender = await getTarget(defenderName, context);

    if (ability.target === "ENEMY" && !defender.isMonster) {
        throw `${ability.name} cannot target battlers`;
    } else if (ability.target === "CHAT" && defender.isMonster) {
        throw `${ability.name} cannot target monsters`;
    }

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

        console.log("Amount:" + amount);

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
    console.log("EXISTING BUFFS: " + JSON.stringify(existingBuffs, null, 5));

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

    let defender = await getTarget(defenderName, context);

    if (ability.target === "ENEMY" && !defender.isMonster) {
        throw `${ability.name} cannot target battlers`;
    } else if (ability.target === "CHAT" && defender.isMonster) {
        throw `${ability.name} cannot target monsters`;
    }

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

    let defender = await getTarget(defenderName, context);

    if (ability.target === "ENEMY" && !defender.isMonster) {
        throw `${ability.name} cannot target battlers`;
    } else if (ability.target === "CHAT" && defender.isMonster) {
        throw `${ability.name} cannot target monsters`;
    }

    var healingAmount = Math.max(1, Util.rollDice(ability.dmg));

    let newValue = 0;
    
    if (ability.dmgStat === "AP") {
        newValue = defender.ap + healingAmount;
    } else if (ability.dmgStat === "Gold") {
        newValue = defender.gold + healingAmount;
    } else {
        newValue = Math.min(defender.maxHp, defender.hp + healingAmount);
    }

    // Get current, unexpanded version
    if (!attacker.isMonster) {
        attacker = await Xhr.getUser(attacker.name);
    }
    if (!defender.isMonster) {
        defender = await Xhr.getUser(defender.name);
    } else {
        defender.aggro[attackerName] += damageRoll;
    }

    defender[ability.dmgStat.toLowerCase()] = newValue;

    // Update attacker and target stats
    if (!attacker.isMonster) {
        await Xhr.updateUser(attacker);
        attacker = Util.expandUser(attacker, context);
    }
    if (!defender.isMonster) {
        await Xhr.updateUser(defender);
        defender = Util.expandUser(defender, context);
    }

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

    if (Math.max(0, attacker.ap) <= 1) {
        throw `@${attackerName} needs 1 AP to use this ability.`;
    }

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
        mods: {
            hit: 0,
            str: 0
        }
    }, context);

    if (!attacker.isMonster) {
        let basicUser = Xhr.getUser(attackerName);
        basicUser.ap -= 1;
        Xhr.updateUser(basicUser);
    }

    return results;
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
    attack,
    heal,
    buff,
    hurt,
    cleanse,
    spawnMonster,
    giveItem,
    giveItemFromInventory
}