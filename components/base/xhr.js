const axios = require('axios');
const Util = require('./util');

const BATTLE_BOT_ACCESS_TOKEN = process.env.TWITCH_BOT_ACCESS_TOKEN;
const BATTLE_BOT_JWT = process.env.TWITCH_BOT_JWT;
const BATTLE_API_URL = process.env.BATTLE_API_URL;
const PROFILE_API_URL = process.env.PROFILE_API_URL;
const WTD_API_URL = "https://deusprogrammer.com/api/dubs";
const TWITCH_EXT_CHANNEL_ID = process.env.TWITCH_EXT_CHANNEL_ID;

const headers = {
    "X-Access-Token": BATTLE_BOT_ACCESS_TOKEN,
    "Authorization": `Bearer ${BATTLE_BOT_JWT}`
}

const maxContentLength = Infinity;
const maxBodyLength = Infinity;

const getBotConfig = async (channel) => {
    let res = await axios.get(`${BATTLE_API_URL}/bots/${channel}`, {
        headers
    });

    return res.data;
}

const getVideo = async (id) => {
    console.log("SEARCHING FOR ID: " + id);
    let result = await axios.get(`${WTD_API_URL}/videos/${id}`, {
        headers
    });

    return result.data;
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
    return axios.get(`${BATTLE_API_URL}/monsters`, {
        headers
    })
        .then((response) => {
            return Util.indexArrayToMap(response.data);
        })
}

const updateMonster = async (monster) => {
    return axios.put(`${BATTLE_API_URL}/monsters/${monster.id}`, monster, {
        headers,
        maxBodyLength,
        maxContentLength
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
        headers,
        maxBodyLength,
        maxContentLength
    })
}

const updateUser = async (user) => {
    await axios.put(`${BATTLE_API_URL}/users/${user.name}`, user, {
        headers,
        maxBodyLength,
        maxContentLength
    });
}

const addCurrency = async (user, amount) => {
    // If currencies isn't defined, define it.
    if (!user.currencies) {
        user.currencies = {};
    }

    // If currency for this channel isn't defined, define it.
    if (!user.currencies[TWITCH_EXT_CHANNEL_ID]) {
        user.currencies[TWITCH_EXT_CHANNEL_ID] = 0;
    }

    // Increase currency
    user.currencies[TWITCH_EXT_CHANNEL_ID] += amount;

    // Save user
    await updateUser(user);
}

const createUser = async (userName, userId) => {
    try {
        await axios.post(`${PROFILE_API_URL}/users`, {
            username: userName,
            password: Util.randomUuid(),
            connected: {
                twitch: {
                    userId: userId,
                    name: userName
                }
            }
        }, {
            headers,
            maxBodyLength,
            maxContentLength
        });
    } catch (e) {
        console.log("Failed to create user " + e);
        throw e;
    }

    try {
        let user = {
            id: userId,
            name: userName,
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
            gold: 100,
            currencies: {}
        };

        await axios.post(`${BATTLE_API_URL}/users`, user, 
        {
            headers,
            maxBodyLength,
            maxContentLength
        });

        return user;
    } catch (e) {
        console.error("Error creating battler: " + e);
        throw e;
    }
}

const chargeAP = async (userName, amount) => {
    let user = await getUser(userName, false);

    user.ap += amount;

    await updateUser(user);
}

const reviveAvatar = async (userName) => {
    let user = await getUser(userName, false);

    if (user.hp > 0) {
        return;
    }

    user.hp = 100;

    await updateUser(user);
}

module.exports = {
    getVideo,
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
    addCurrency,
    updateUser,
    updateMonster,
    createUser,
    chargeAP,
    reviveAvatar,
    getBotConfig
}