const axios = require('axios');
const Util = require('./util');
const jsonwebtoken = require('jsonwebtoken');

const BATTLE_BOT_JWT = process.env.TWITCH_BOT_JWT;
const BATTLE_API_URL = process.env.BATTLE_API_URL;
const PROFILE_API_URL = process.env.PROFILE_API_URL;

const TWITCH_EXT_CLIENT_ID = process.env.TWITCH_EXT_CLIENT_ID;
const TWITCH_EXT_CHANNEL_ID = process.env.TWITCH_EXT_CHANNEL_ID;
const TWITCH_EXT_API_URL = `https://api.twitch.tv/extensions/message/${TWITCH_EXT_CHANNEL_ID}`;

const key = process.env.TWITCH_SHARED_SECRET;
const secret = Buffer.from(key, 'base64');

const createExpirationDate = () => {
    var d = new Date();
    var year = d.getFullYear();
    var month = d.getMonth();
    var day = d.getDate();
    var c = new Date(year + 1, month, day);
    return c;
}

const pubSubJwtToken = jsonwebtoken.sign({
    "exp": createExpirationDate().getTime(),
    "user_id": TWITCH_EXT_CHANNEL_ID,
    "role": "broadcaster",
    "channel_id": TWITCH_EXT_CHANNEL_ID,
    "pubsub_perms": {
        "send":[
            "broadcast"
        ]
    }
}, secret);

const sendExtensionPubSubBroadcast = async (event) => {
    let message = {
        content_type: "application/json",
        message: JSON.stringify(event),
        targets: ["broadcast"]
    }

    console.log("BODY: " + JSON.stringify(message, null, 5));

    let res = await axios.post(TWITCH_EXT_API_URL, message, {
        headers: {
            "Client-Id": TWITCH_EXT_CLIENT_ID,
            "Authorization": `Bearer ${pubSubJwtToken}`
        }
    });

    return res.data;
}

const getTwitchProfile = async (userId) => {
    let url = `https://api.twitch.tv/kraken/users/${userId}`;
    console.log(`URL : ${url}`);
    let res = await axios.get(url, {
        headers: {
            "Client-ID": `z91swgqes7e0y7r8oa1t32u6uokyiw`,
            Accept: "application/vnd.twitchtv.v5+json"
        }
    });

    return res.data;
}

const getItemTable = () => {
    return axios.get(`${BATTLE_API_URL}/items`, {
        headers: {
            Authorization: `Bearer ${BATTLE_BOT_JWT}`
        }
    })
        .then((response) => {
            return Util.indexArrayToMap(response.data);
        })
}

const getJobTable = () => {
    return axios.get(`${BATTLE_API_URL}/jobs`, {
        headers: {
            Authorization: `Bearer ${BATTLE_BOT_JWT}`
        }
    })
        .then((response) => {
            return Util.indexArrayToMap(response.data);
        })
}

const getMonsterTable = () => {
    return axios.get(`${BATTLE_API_URL}/monsters`, {
        headers: {
            Authorization: `Bearer ${BATTLE_BOT_JWT}`
        }
    })
        .then((response) => {
            return Util.indexArrayToMap(response.data);
        })
}

const updateMonster = async (monster) => {
    return axios.put(`${BATTLE_API_URL}/monsters/${monster.id}`, monster, {
        headers: {
            Authorization: `Bearer ${BATTLE_BOT_JWT}`
        }
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
        headers: {
            Authorization: `Bearer ${BATTLE_BOT_JWT}`
        }
    })
        .then((response) => {
            return Util.indexArrayToMap(response.data);
        })
}

const getActiveUsers = async (context) => {
    let chatters = Object.keys(context.chattersActive);

    let r = await axios.get(`${BATTLE_API_URL}/users`, {
        headers: {
            Authorization: `Bearer ${BATTLE_BOT_JWT}`
        }
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
            headers: {
                Authorization: `Bearer ${BATTLE_BOT_JWT}`
            }
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
            headers: {
                Authorization: `Bearer ${BATTLE_BOT_JWT}`
            }
        })

        return itemResponse.data;
    } catch (e) {
        console.error(e);
        return null;
    }
}

const updateUser = async (user) => {
    await axios.put(`${BATTLE_API_URL}/users/${user.name}`, user, {
        headers: {
            contentType: "application/json",
            Authorization: `Bearer ${BATTLE_BOT_JWT}`
        }
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
            headers: {
                contentType: "application/json",
                Authorization: `Bearer ${BATTLE_BOT_JWT}`
            }
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
            headers: {
                contentType: "application/json",
                Authorization: `Bearer ${BATTLE_BOT_JWT}`
            }
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
    getTwitchProfile,
    sendExtensionPubSubBroadcast
}