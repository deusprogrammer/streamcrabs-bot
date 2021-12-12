const axios = require('axios');
const Util = require('./util');

const BATTLE_BOT_ACCESS_TOKEN = process.env.TWITCH_BOT_ACCESS_TOKEN;
const BATTLE_BOT_JWT = process.env.TWITCH_BOT_JWT;
const BATTLE_API_URL = process.env.BATTLE_API_URL;
const BOT_CONFIG_API_URL = process.env.BOT_CONFIG_API_URL;
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
    let res = await axios.get(`${BOT_CONFIG_API_URL}/bots/${channel}`, {
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

const giveGold = async (user, currency, channel) => {
    await axios.post(`${BATTLE_API_URL}/users/${user.name}/changes`, 
        {
            type: "give",
            currency,
            channel
        }, {
        headers,
        maxBodyLength,
        maxContentLength
    });
}

const giveItem = async (user, id) => {
    await axios.post(`${BATTLE_API_URL}/users/${user.name}/changes`, {
        type: "give",
        id
    }, {
        headers,
        maxBodyLength,
        maxContentLength
    });
}

const removeItem = async (user, id) => {
    await axios.post(`${BATTLE_API_URL}/users/${user.name}/changes`, {
        type: "remove",
        id
    }, {
        headers,
        maxBodyLength,
        maxContentLength
    });
}

const adjustStats = async (user, adjustments) => {
    await axios.post(`${BATTLE_API_URL}/users/${user.name}/changes`, {
        type: "adjust",
        adjustments
    }, {
        headers,
        maxBodyLength,
        maxContentLength
    });
}

const addCurrency = async (user, amount) => {
    giveGold(user, amount, TWITCH_EXT_CHANNEL_ID);
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
    let adjustments = {ap: amount};
    await adjustStats({name: userName}, adjustments);
}

const reviveAvatar = async (userName) => {
    let adjustments = {hp: 100};
    
    await adjustStats({name: userName}, adjustments);
}

const getDynamicAlert = async (id) => {
    let found = await axios.get(`${BOT_CONFIG_API_URL}/dynamic-alerts/${id}`, {
        headers,
        maxBodyLength,
        maxContentLength
    });

    return found.data;
}

module.exports = {
    getDynamicAlert,
    giveGold,
    giveItem,
    removeItem,
    adjustStats,
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
    addCurrency,
    updateMonster,
    createUser,
    chargeAP,
    reviveAvatar,
    getBotConfig
}