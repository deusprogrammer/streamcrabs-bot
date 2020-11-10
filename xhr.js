const axios = require('axios');
const Util = require('./util');

// const BATTLE_BOT_JWT = process.env.TWITCH_BOT_JWT;
const BATTLE_BOT_ACCESS_TOKEN = process.env.TWITCH_BOT_ACCESS_TOKEN;
const BATTLE_API_URL = process.env.BATTLE_API_URL;
const PROFILE_API_URL = process.env.PROFILE_API_URL;
const AUTH_API_URL = process.env.AUTH_API_URL;
const TWITCH_EXT_CHANNEL_ID = process.env.TWITCH_EXT_CHANNEL_ID;

const headers = {
    "X-Access-Token": BATTLE_BOT_ACCESS_TOKEN
}

const authenticateBot = async (username, password) => {
    let authResponse = await axios.post(`${AUTH_API_URL}/items/${itemId}`, {
        username,
        password
    });

    return authResponse.data.id;
}

const getItemTable = () => {
    return axios.get(`${BATTLE_API_URL}/items`, {
        headers
    })
        .then((response) => {
            return Util.indexArrayToMap(response.data);
        })
}

const getJobTable = () => {
    return axios.get(`${BATTLE_API_URL}/jobs`, {
        headers
    })
        .then((response) => {
            return Util.indexArrayToMap(response.data);
        })
}

const getMonsterTable = () => {
    return axios.get(`${BATTLE_API_URL}/monsters}`, {
        headers
    })
        .then((response) => {
            return Util.indexArrayToMap(response.data);
        })
}

const updateMonster = async (monster) => {
    return axios.put(`${BATTLE_API_URL}/monsters/${monster.id}`, monster, {
        headers
    })
}

const adjustPlayer = async (username, statUpdates, newInventory, newEquipment, context) => {
    let user = {};

    if (username.startsWith("~")) {
        user = context.encounterTable[username];
    } else {
        user = await getUser(username);
    }

    if (statUpdates.hp) {
        user.hp += statUpdates.hp;
    }

    if (statUpdates.ap) {
        user.ap += statUpdates.ap;
    }

    if (statUpdates.gold) {
        user.gold += statUpdates.gold;
    }

    if (newInventory) {
        user.inventory = [...user.inventory, ...newInventory];
    }

    if (newEquipment) {
        for (const slot in Object.keys(newEquipment)) {
            user.equipment[slot] = newEquipment[slot];
        }
    }

    if (!username.startsWith("~")) {
        await updateUser(user);
    }
}

const getAbilityTable = () => {
    return axios.get(`${BATTLE_API_URL}/abilities`, {
        headers
    })
        .then((response) => {
            return Util.indexArrayToMap(response.data);
        })
}

const getActiveUsers = async (context) => {
    let chatters = Object.keys(context.chattersActive);

    let r = await axios.get(`${BATTLE_API_URL}/users`, {
        headers
    });

    let users = r.data.map((user) => {
        return user.name;
    });

    return chatters.filter((chatter) => {
        return users.includes(chatter);
    });
}

const getUser = async (username) => {
    try {
        let userResponse = await axios.get(`${BATTLE_API_URL}/users/${username}`, {
            headers
        })

        return userResponse.data;
    } catch (e) {
        console.error(e);
        return null;
    }
}

const getItem = async (itemId) => {
    try {
        let itemResponse = await axios.get(`${BATTLE_API_URL}/items/${itemId}`, {
            headers
        })

        return itemResponse.data;
    } catch (e) {
        console.error(e);
        return null;
    }
}

const getSealedItem = async (itemId) => {
    try {
        let itemResponse = await axios.get(`${BATTLE_API_URL}/sealed-items/${itemId}`, {
            headers
        })

        return itemResponse.data;
    } catch (e) {
        console.error(e);
        return null;
    }
}

const updateSealedItem = async (item) => {
    await axios.put(`${BATTLE_API_URL}/sealed-items/${item.id}`, item, {
        headers
    })
}

const updateUser = async (user) => {
    await axios.put(`${BATTLE_API_URL}/users/${user.name}`, user, {
        headers
    })
}

const createUser = async (message) => {
    try {
        await axios.post(`${PROFILE_API_URL}/users`, {
            username: message.userName,
            password: Util.randomUuid(),
            connected: {
                twitch: {
                    userId: message.userId,
                    name: message.userName
                }
            }
        }, {
            headers
        });

        await axios.post(`${BATTLE_API_URL}/users`, {
            id: message.userId,
            name: message.userName,
            currentJob: {
                id: "SQUIRE"
            },
            ap: 2,
            hp: 100,
            mp: 10,
            equipment: {
                hand: {
                    id: "LONG_SWORD"
                },
                offhand: {},
                head: {
                    id: "LEATHER_CAP"
                },
                body: {
                    id: "LEATHER_CURIASS"
                },
                arms: {
                    id: "LEATHER_GAUNTLETS"
                },
                legs: {
                    id: "LEATHER_PANTS"
                }
            }, inventory: [
                "POTION",
                "POTION"
            ],
            gold: 100
        }, {
            headers
        });
    } catch (e) {

    }
}

const chargeAP = async (message, amount) => {
    let user = await getUser(message.userName, false);

    user.ap += amount;

    await updateUser(user);
}

const reviveAvatar = async (message) => {
    let user = await getUser(message.userName, false);

    if (user.hp > 0) {
        return;
    }

    user.hp = 100;

    await updateUser(user);
}

module.exports = {
    getUser,
    getItem,
    getSealedItem,
    updateSealedItem,
    getActiveUsers,
    getItemTable,
    getJobTable,
    getMonsterTable,
    getAbilityTable,
    adjustPlayer,
    updateUser,
    updateMonster,
    createUser,
    chargeAP,
    reviveAvatar,
    authenticateBot
}