const indexArrayToMap = (array) => {
    let table = {};
    array.forEach((element) => {
        table[element.id] = element;
    });

    return table;
}

const nthIndex = (str, pat, n) => {
    var L = str.length, i = -1;
    while (n-- && i++ < L) {
        i = str.indexOf(pat, i);
        if (i < 0) break;
    }
    return i + 1;
}

const randomUuid = () => {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

const randomNumber = (max) => {
    return Math.floor(Math.random() * Math.floor(max)) + 1;
}

// TODO Improve dice parser to include other math
const rollDice = (dice) => {
    let tokens = dice.split("d");

    // If it's just a hard coded number, just return the number
    if (tokens.length === 1) {
        return parseInt(tokens[0]);
    }

    let total = 0;
    for (var i = 0; i < parseInt(tokens[0]); i++) {
        total += Math.floor(Math.random() * Math.floor(parseInt(tokens[1]))) + 1;
    }
    return total;
}

const expandUser = (userData, context) => {
    userData.totalAC = 0;
    userData.currentJob = context.jobTable[userData.currentJob.id];
    userData.str = userData.currentJob.str;
    userData.dex = userData.currentJob.dex;
    userData.int = userData.currentJob.int;
    userData.hit = userData.currentJob.hit;
    userData.maxHp = userData.currentJob.hp;
    userData.abilities = {};
    Object.keys(userData.equipment).forEach((slot) => {
        let item = userData.equipment[slot];
        let itemData = context.itemTable[item.id];
        if (itemData.type === "armor") {
            userData.totalAC += itemData.ac;
        }
        userData.totalAC += itemData.mods.ac;
        userData.maxHp += itemData.mods.hp;
        userData.str += itemData.mods.str;
        userData.dex += itemData.mods.dex;
        userData.int += itemData.mods.int;
        userData.hit += itemData.mods.hit;
        itemData.abilities.forEach((abilityId) => {
            userData.abilities[abilityId] = context.abilityTable[abilityId];
        });
        userData.equipment[slot] = itemData;
    });
    let newInventoryList = [];
    userData.inventory.forEach((item) => {
        newInventoryList.push(context.itemTable[item]);
    });

    if (userData.maxHp < 0) {
        userData.maxHp = 1;
    }

    if (userData.hp > userData.maxHp) {
        userData.hp = userData.maxHp;
    }

    userData.inventory = newInventoryList;
    userData.actionCooldown = Math.min(11, 6 - Math.min(5, userData.dex));

    return userData;
}

module.exports = {
    indexArrayToMap,
    nthIndex,
    rollDice,
    expandUser,
    randomUuid,
    randomNumber
}