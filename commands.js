var Xhr = require('./xhr');
var Util = require('./util');

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
    for (var attacker in monster.aggro) {
        for (var i in drops) {
            let drop = drops[i];
            let chanceRoll = Util.rollDice("1d100");
            if (chanceRoll < drop.chance && !(drop.exclusive && drop.exclusiveTaken)) {
                // If only one of these can drop for a given monster
                if (drop.onlyOne && taken[drop.itemId]) {
                    continue;
                }
                
                taken[drop.itemId] = true;
                await giveItem("", attacker, drop.itemId);

                // If exclusive, mark the drop as permanently taken
                if (drop.exclusive) {
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
                break;
            }
        }
    }

    return events;
}

const hurt = async (attackerName, defenderName, ability, context) => {
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
    let damageRoll = Util.rollDice(ability.dmg, defender.hp);
    let modifiedDamageRoll = Math.max(1, damageRoll + attacker.str + ability.mods.str + attackerBuffs.str);
    let hit = true;
    let crit = false;
    let dead = false;

    if (ability.ignoreDamageMods) {
        modifiedDamageRoll = damageRoll;
    }

    console.log(`ATTACK ROLL ${modifiedAttackRoll} (${attackRoll} + ${attacker[ability.toHitStat.toLowerCase()]} + ${ability.mods[ability.toHitStat.toLowerCase()]} + ${attackerBuffs[ability.toHitStat.toLowerCase()]}) vs AC ${defender.totalAC + defenderBuffs.ac} (${defender.totalAC} + ${defenderBuffs.ac})`);
    console.log(`DAMAGE ROLL ${modifiedDamageRoll} (${damageRoll} + ${attacker.str} + ${ability.mods.str} + ${attackerBuffs.str})`);

    if (attackRoll === 20) {
        modifiedDamageRoll *= 2;
        crit = true;
        message = `${attacker.name} ==> ${defender.name} -${modifiedDamageRoll}HP`;
        console.log("CRIT");
    } else if (modifiedAttackRoll >= defender.totalAC + defenderBuffs.ac) {
        message = `${attacker.name} ==> ${defender.name} -${modifiedDamageRoll}HP`;
        console.log("HIT");
    } else {
        message = `${attacker.name} ==> ${defender.name} MISS`;
        hit = false;
        console.log("MISS");
    }

    if (hit && modifiedDamageRoll >= defender.hp) {
        endStatus = `[DEAD]`;
        dead = true;
    } else {
        endStatus = `[${defender.hp - modifiedDamageRoll}/${defender.maxHp}HP]`;
    }

    // Get current, unexpanded version
    if (!attacker.isMonster) {
        attacker = await Xhr.getUser(attacker.name);
        attacker.ap -= ability.ap;
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
        defender.hp -= modifiedDamageRoll;
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

    return {
        message: `[BATTLE]: ${message}  ${hit ? endStatus : ''}`,
        damage: modifiedDamageRoll,
        flags: {
            crit,
            hit,
            dead
        },
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
        let groups = token.match(/(STR|DEX|INT|HIT|AC)\+*(\-*[0-9]+)/);

        if (!groups && groups.length < 3) {
            throw `Bad buff string on ability ${ability.name}`;
        }

        return {
            stat: groups[1],
            amount: parseInt(groups[2])
        }
    })

    // Combine with other buffs
    let existingBuffs = context.buffTable[defenderName] || [];
    context.buffTable[defenderName] = [...existingBuffs,
        {
            name: ability.name,
            duration: ability.buffsDuration,
            changes
        }
    ]


    return {
        attacker,
        defender,
        flags: {
            crit: false,
            hit: false,
            dead: false
        },
        message: `${defender.name} is affected by ${ability.name}`,
        damage: 0,
        damageType: "BUFFING"
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
    spawnMonster,
    giveItem,
    giveItemFromInventory
}