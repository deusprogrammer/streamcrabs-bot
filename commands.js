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

const giveItemFromInventory = async (giverName, username, itemId, context) => {
    let giver = await Xhr.getUser(giverName);
    let user  = await Xhr.getUser(username);
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
        message: `${giverName} gave ${username} a ${item.name}`
    }
}

const attack = async (attackerName, defenderName, context) => {
    try {
      let attacker = {};
      
      if (attackerName.startsWith("~")) {
        attackerName = attackerName.substring(1);
        attacker = context.encounterTable[attackerName];
        if (!attacker) {
          return {
            error: `${attackerName} does not have a battle avatar`
          };
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
          return {
              error: `@${attackerName} doesn't have a battle avatar.`
          };
        }

        attacker.isMonster = false;
        attacker = Util.expandUser(attacker, context);
      }

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
  
      if (defenderName.startsWith("~")) {
        defenderName = defenderName.substring(1);
        defender = context.encounterTable[defenderName];

        if (!defender) {
          return {
            error: `${defenderName} does not have a battle avatar`
          };
        }

        defender.isMonster = true;
        defender.maxHp = context.monsterTable[defender.id].hp;
        defender.totalAC = defender.ac;
        defender.encounterTableKey = defenderName;
      } else {
        defender = await Xhr.getUser(defenderName);

        if (!defender) {
            return {
                error: `${defenderName} does not have a battle avatar`
              };
        }

        defender.isMonster = false;
        defender = Util.expandUser(defender, context);
      }

      console.log("DEFENDER: " + JSON.stringify(defender, null, 5));
  
      if (defender && !targets.includes(defenderName) && !context.encounterTable[defenderName]) {
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
      let modifiedAttackRoll = attackRoll + attacker.hit;
      let damageRoll = Util.rollDice(weapon.dmg) + attacker.str;
      let hit = true;

      if (attackRoll === 20) {
        damageRoll *= 2;
        //message = `SMASSSSSSH!  ${attacker.name} hit ${defender.name} for ${damageRoll} damage!`;
        message = `${attacker.name} ==> ${defender.name} -${damageRoll}HP`;
      } else if (modifiedAttackRoll > defender.totalAC) {
        //message = `${attacker.name} swung at ${defender.name} and hit for ${damageRoll} damage.`;
        message = `${attacker.name} ==> ${defender.name} -${damageRoll}HP`;
      } else {
        //message = `${attacker.name} swung at ${defender.name} and missed!`;
        message = `${attacker.name} ==> ${defender.name} MISS`;
        hit = false;
      }
  
      if (damageRoll >= defender.hp) {
        //endStatus = `${defender.name} is dead!`;
        endStatus = `[DEAD]`;
      } else {
        //endStatus = `${defender.name} has ${defender.hp - damageRoll} HP left.`;
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
        defender.aggro[attackerName] = damageRoll;
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
        attacker,
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