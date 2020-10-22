var Xhr = require('./xhr');
var Util = require('./util');

const giveItem = async (giverName, username, itemId) => {
    let user = await Xhr.getUser(username, false);
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

    if (!user) {
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
    user.inventory.push(itemId);

    await Xhr.updateUser(giver);
    await Xhr.updateUser(user);

    return {
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
    // Give drops to everyone who attacked the monster
    for (var attacker in monster.aggro) {
        for (var i in monster.drops) {
            var drop = monster.drops[i];
            var chanceRoll = Util.rollDice("1d100");
            if (chanceRoll < drop.chance && !(drop.onlyOne && drop.taken)) {
                drop.taken = true;
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
                        encounterTable: context.encounterTable
                    }
                });
                break;
            }
        }
    }
}

const hurt = async (attackerName, defenderName, ability, context) => {
    if (ability.element === "HEALING") {
        throw `@${ability.name} is not an attack ability`;
    }

    let targets = await Xhr.getActiveUsers(context);

    let attacker = await getTarget(attackerName, context);

    if (attacker.hp <= 0) {
        throw `@${attackerName} is dead and cannot perform any actions.`;
    }

    if (Math.max(0, attacker.ap) <= ability.ap) {
        throw `@${attackerName} needs ${ability.ap} AP to use this ability.`;
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

    let attackRoll = Util.rollDice("1d20");
    let modifiedAttackRoll = attackRoll + attacker.hit + ability.mods.hit;
    let damageRoll = Util.rollDice(ability.dmg) + attacker.str + ability.mods.str;
    let hit = true;
    let crit = false;
    let dead = false;

    if (attackRoll === 20) {
        damageRoll *= 2;
        crit = true;
        message = `${attacker.name} ==> ${defender.name} -${damageRoll}HP`;
    } else if (modifiedAttackRoll > defender.totalAC) {
        message = `${attacker.name} ==> ${defender.name} -${damageRoll}HP`;
    } else {
        message = `${attacker.name} ==> ${defender.name} MISS`;
        hit = false;
    }

    if (damageRoll >= defender.hp) {
        endStatus = `[DEAD]`;
        dead = true;
    } else {
        endStatus = `[${defender.hp - damageRoll}/${defender.maxHp}HP]`;
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
        defender.aggro[attackerName] += damageRoll;
    }

    if (hit) {
        defender.hp -= damageRoll;
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
        damage: damageRoll,
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

const heal = async (attackerName, defenderName, ability, context) => {
    if (ability.element !== "HEALING") {
        throw `@${ability.name} is not a healing ability`;
    }

    let targets = await Xhr.getActiveUsers(context);

    let attacker = await getTarget(attackerName, context);

    if (attacker.hp <= 0) {
        throw `@${attackerName} is dead and cannot perform any actions.`;
    }

    if (Math.max(0, attacker.ap) <= ability.ap) {
        throw `@${attackerName} needs ${ability.ap} AP to use this ability.`;
    }

    let defender = await getTarget(defenderName, context);

    if (defender && !targets.includes(defenderName) && !defender.isMonster) {
        throw `@${defenderName}'s not here man!`;
    }

    if (ability.target === "ENEMY" && !defender.isMonster) {
        throw `${ability.name} cannot target battlers`;
    } else if (ability.target === "CHAT" && defender.isMonster) {
        throw `${ability.name} cannot target monsters`;
    }

    var healingAmount = Util.rollDice(ability.dmg);

    let newHp = Math.min(defender.maxHp, defender.hp + healingAmount);

    // Get current, unexpanded version
    if (!attacker.isMonster) {
        attacker = await Xhr.getUser(attacker.name);
        attacker.ap -= ability.ap;
    }
    if (!defender.isMonster) {
        defender = await Xhr.getUser(defender.name);
    } else {
        defender.aggro[attackerName] += damageRoll;
    }

    defender.hp = newHp;

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
        message: `${attacker.name} healed ${defender.name} for ${healingAmount} HP`,
        damage: healingAmount,
        damageType: "HEALING"
    };
}

const attack = async (attackerName, defenderName, context) => {
    let attacker = await getTarget(attackerName, context);

    if (attacker.hp <= 0) {
        throw `@${attackerName} is dead and cannot perform any actions.`;
    }

    if (attacker.ap <= 0) {
        throw `@${attackerName} is out of action points and cannot perform any actions.`;
    }

    let weapon = attacker.equipment.hand;

    return await hurt(attackerName, defenderName, {
        name: "attack",
        dmg: weapon.dmg,
        ap: 1,
        target: "ANY",
        area: "ONE",
        mods: {
            hit: 0,
            str: 0
        }
    }, context);
}

const spawnMonster = async (monsterName, personalName, context) => {
    // Retrieve monster from monster table
    let monster = context.monsterTable[monsterName.toUpperCase()];

    if (!monster) {
        throw `${monsterName} is not a valid monster`;
    }

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
    distributeLoot,
    attack,
    heal,
    hurt,
    spawnMonster,
    giveItem,
    giveItemFromInventory
}