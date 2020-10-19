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
    let user  = await Xhr.getUser(username);
    let item  = await Xhr.getItem(itemId);
  
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

const attack = async (attackerName, defenderName, context) => {
    try {
      // Get active users
      let targets = await Xhr.getActiveUsers(context);

      // ATTACKER
      let attacker = {};
      if (attackerName.startsWith("~")) {
        attackerName = attackerName.substring(1);
        attacker = context.encounterTable[attackerName];
        if (!attacker) {
          throw `${attackerName} is not a valid monster`;
        }

        attacker.isMonster = true;
        attacker.equipment = {
          hand: {
            dmg: attacker.dmg || "1d6",
            mods: {
              hit: attacker.hit
            }
          }
        };
        attacker.totalAC = attacker.ac;
        attacker.encounterTableKey = attackerName;
      } else {
        attacker = await Xhr.getUser(attackerName);

        if (!attacker) {
          throw `@${attackerName} doesn't have a battle avatar.`;
        }

        attacker.isMonster = false;
        attacker = Util.expandUser(attacker, context);
      }
  
      if (attacker.hp <= 0) {
        throw `@${attackerName} is dead and cannot perform any actions.`;
      } 
      
      if (attacker.ap <= 0) {
        throw `@${attackerName} is out of action points and cannot perform any actions.`;
      }
  
      // DEFENDER
      let defender = {}
      if (defenderName.startsWith("~")) {
        defenderName = defenderName.substring(1);
        defender = context.encounterTable[defenderName];

        if (!defender) {
          throw `${defenderName} is not a valid monster to target`;
        }

        defender.isMonster = true;
        defender.totalAC = defender.ac;
        defender.encounterTableKey = defenderName;
      } else {
        defender = await Xhr.getUser(defenderName);

        if (!defender) {
          throw `${defenderName} does not have a battle avatar`;
        }

        defender.isMonster = false;
        defender = Util.expandUser(defender, context);
      }
  
      if (defender && !targets.includes(defenderName) && !context.encounterTable[defenderName]) {
        throw `@${defenderName}'s not here man!`;
      }
      
      if (!defender) {
        throw `There is no such target ${defenderName}`;
      }
  
      if (defender.hp <= 0) {
        throw `@${defenderName} is already dead.`;
      }
  
      let message = "";
      let endStatus = "";
  
      let weapon = attacker.equipment.hand;

      let attackRoll = Util.rollDice("1d20");
      let modifiedAttackRoll = attackRoll + attacker.hit;
      let damageRoll = Util.rollDice(weapon.dmg) + attacker.str;
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
        attacker.ap -= 1;
      }
      if (!defender.isMonster) {
        defender = await Xhr.getUser(defender.name);
      } else {
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
        defender
      }
    } catch (e) {
      throw "Failed to run battle: " + e;
    }
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
    attack,
    spawnMonster,
    giveItem,
    giveItemFromInventory
}