var Xhr = require('./xhr');
var Util = require('./util');

const giveItem = async (giverName, username, itemId) => {
    let user = await Xhr.getUser(username, false);
    let item = await Xhr.getItem(itemId);
  
    if (!user) {
      return {
          error: `No user named ${username} found`
      };
    }
  
    if (!item) {
      return {
          error: `No item with item id ${itemId} found`
      };
    }
  
    user.inventory.push(itemId);
  
    await Xhr.updateUser(user);
  
    return {
        message: `${giverName} gave ${username} a ${item.name}`
    }
}

const giveItemFromInventory = async (giverName, username, itemId, itemTable, jobTable) => {
    let giver = Util.expandUser(await Xhr.getUser(giverName), itemTable, jobTable);
    let user  = Util.expandUser(await Xhr.getUser(username), itemTable, jobTable);
    let item  = await Xhr.getItem(itemId);
  
    if (!giver) {
      return {
          error: `No user named ${username} found`
      };
    }
  
    if (!user) {
      return {
        error: `No user named ${username} found`
      };
    }
  
    if (!item) {
      return {
        error: `No item with item id ${itemId} found`
      };
    }
  
    let index = giver.inventory.indexOf(itemId);
  
    if (index < 0) {
      return {
        error: `${giverName} has no ${item.name} to give`
      };
    }
  
    giver.inventory.splice(index, 1);
    user.inventory.push(itemId);
  
    await Xhr.updateUser(giver);
    await Xhr.updateUser(user);

    return {
        message: `${giver} gave ${username} a ${item.name}`
    }
}

const attack = async (attackerName, defenderName, encounterTable, itemTable, jobTable, abilityTable) => {
    try {
      let attacker = await Xhr.getUser(attackerName);

      if (!attacker) {
        return {
            error: `@${attackerName} doesn't have a battle avatar.`
        };
      }

      attacker = Util.expandUser(attacker, itemTable, jobTable, abilityTable);

      console.log("ATTACKER: " + JSON.stringify(attacker, null, 5));
  
      if (attacker.hp <= 0) {
        return {
          error: `@${attackerName} is dead and cannot perform any actions.`
        };
      } else if (attacker.ap <= 0) {
        return {
          error: `@${attackerName} is out of action points and cannot perform any actions.`
        };
      }
  
      let targets = await Xhr.getActiveUsers();
  
      let defender = {}
      let isMonster = false;
  
      if (defenderName.startsWith("~")) {
        defenderName = defenderName.substring(1);
        defender = encounterTable[defenderName];
        isMonster = true;
        defender.currentJob = {
          str: defender.str,
          dex: defender.dex,
          int: defender.int
        }
        defender.totalAC = defender.ac;
        defender.encounterTableKey = defenderName;
      } else {
        defender = await Xhr.getUser(defenderName);

        if (!defender) {
            return {
                error: `@${defenderName}'s does not have a battle avatar`
              };
        }

        defender = Util.expandUser(defender, itemTable, jobTable, abilityTable);
      }

      console.log("DEFENDER: " + JSON.stringify(defender, null, 5));
  
      if (defender && !targets.includes(defenderName) && !encounterTable[defenderName]) {
        return {
          error: `@${defenderName}'s not here man!`
        };
      }
      
      if (!defender) {
        return {
          error: `There is no such target ${defenderName}`
        }
      }
  
      if (defender.hp <= 0) {
        return {
          error: `@${defenderName} is already dead.`
        };
      }
  
      let message = "";
      let endStatus = "";
  
      let weapon = attacker.equipment.hand;
      let attackRoll = Util.rollDice("1d20");
      let modifiedAttackRoll = attackRoll + attacker.currentJob.str;
      let damageRoll = Util.rollDice(weapon.dmg) + attacker.currentJob.str;
      let hit = true;
  
      if (attackRoll === 20) {
        damageRoll *= 2;
        message = `SMASSSSSSH!  ${attacker.name} hit ${defender.name} for ${damageRoll} damage!`
      } else if (modifiedAttackRoll > defender.totalAC) {
        message = `${attacker.name} swung at ${defender.name} and hit for ${damageRoll} damage.`;
      } else {
        message = `${attacker.name} swung at ${defender.name} and whiffed!`;
        hit = false;
      }
  
      if (damageRoll >= defender.hp) {
        endStatus = `${defender.name} is dead!`;
      } else {
        endStatus = `${defender.name} has ${defender.hp - damageRoll} HP left.`
      }
  
      // Get current, unexpanded version
      attacker = await Xhr.getUser(attacker.name);
      if (!isMonster) {
        defender = await Xhr.getUser(defender.name);
      }
  
      attacker.ap -= 1;

      if (hit) {
        defender.hp -= damageRoll;
      }
  
      // Update attacker and target stats
      await Xhr.updateUser(attacker);
      if (!isMonster && hit) {
        await Xhr.updateUser(defender);
      }
  
      return {
        message: `${message}  ${hit ? endStatus : ''}`,
        defender
      }
    } catch (e) {
      return {
        error: "Failed to run battle: " + e
      }
    }
}

module.exports = {
    attack,
    giveItem,
    giveItemFromInventory
}