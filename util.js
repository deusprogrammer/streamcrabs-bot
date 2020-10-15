const indexArrayToMap = (array) => {
    let table = {};
    array.forEach((element) => {
      table[element.id] = element;
    });
  
    return table;
}

const nthIndex = (str, pat, n) => {
    var L= str.length, i= -1;
    while(n-- && i++<L){
        i= str.indexOf(pat, i);
        if (i < 0) break;
    }
    return i + 1;
}
  
const randomUuid = () => {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}
  
  // TODO Improve dice parser to include other math
const rollDice = (dice) => {
    let tokens = dice.split("d");
    let total = 0;
    for (var i = 0; i < tokens[0]; i++) {
      total += Math.floor(Math.random() * Math.floor(tokens[1])) + 1;
    }
    return total;
}

const expandUser = (userData, itemTable, jobTable, abilityTable) => {
    let totalAC = 0;
    Object.keys(userData.equipment).forEach((slot) => {
      let item = userData.equipment[slot];
      let itemData = itemTable[item.id];
      if (itemData.type === "armor") {
        totalAC += itemData.ac;
      }
      userData.equipment[slot] = itemData;
    });
    let newInventoryList = [];
    userData.inventory.forEach((item) => {
      newInventoryList.push(itemTable[item]);
    });
  
    userData.inventory = newInventoryList;
    userData.currentJob = jobTable[userData.currentJob.id];
    userData.totalAC = totalAC + userData.currentJob.dex;
  
    return userData;
}

module.exports = {
    indexArrayToMap,
    nthIndex,
    rollDice,
    expandUser,
    randomUuid
}