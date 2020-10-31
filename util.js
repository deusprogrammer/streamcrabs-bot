const {spawn} = require('child_process');
const crypto = require('crypto');

function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

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

const rollDice = (dice, of) => {
    let tokens = dice.split("d");

    // If it's just a hard coded number, just return the number
    if (tokens.length === 1) {
        if (tokens[0].endsWith("%")) {
            let percent = parseInt(tokens[0].substring(0, tokens[0].length - 1));
            console.log("PERCENT: " + percent);
            return Math.ceil(percent/100 * of);
        }
        return parseInt(tokens[0]);
    }

    // Otherwise roll dice
    let total = 0;
    for (var i = 0; i < parseInt(tokens[0]); i++) {
        total += Math.floor(Math.random() * Math.floor(parseInt(tokens[1]))) + 1;
    }
    return total;
}

const sign = (number) => {
    if (number >= 0) {
        return `+${number}`;
    }
    return `${number}`;
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

const restartProcess = () => {
    spawn(process.argv[0], process.argv.slice(1), {
        detached: true,
        stdio: ['ignore', process.stdout, process.stderr]
    }).unref()
    process.exit()
}

const hmacSHA1 = (key, data) => {
    return crypto.createHmac('sha1', key).update(data).digest().toString('base64');
}

module.exports = {
    shuffle,
    indexArrayToMap,
    nthIndex,
    rollDice,
    sign,
    expandUser,
    randomUuid,
    randomNumber,
    restartProcess,
    hmacSHA1
}