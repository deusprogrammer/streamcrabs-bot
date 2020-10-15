const axios = require('axios');
const Util = require('./util');

const BATTLE_BOT_JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyIjp7Il9pZCI6IjVmN2NmZjY0NTk1OWY3MDAxNDFjYjhhMSIsInVzZXJuYW1lIjoibWlrdV90aGVfc3BhY2VfYm90Iiwicm9sZXMiOlsiVFdJVENIX0JPVCJdLCJjb25uZWN0ZWQiOnsidHdpdGNoIjp7fX19LCJpYXQiOjE2MDIwMzU3MjB9.hywhuHwhr3KMePkh3XP6K3dg8iFksZCJIaXmdzBnh7Y';
const BATTLE_API_URL = process.env.BATTLE_API_URL;
const PROFILE_API_URL = process.env.PROFILE_API_URL;

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
  
const getChatters = async () => {
    let chatters = []
    let r = await axios.get("https://tmi.twitch.tv/group/user/thetruekingofspace/chatters")
    Object.keys(r.data.chatters).forEach((category) => {
      chatters.push(...r.data.chatters[category]);
    });
  
    return chatters;
}
  
const getActiveUsers = async () => {
    let chatters = await getChatters();
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
    } catch(e) {
      
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
    getChatters,
    getItemTable,
    getJobTable,
    getMonsterTable,
    getAbilityTable,
    updateUser,
    createUser,
    chargeAP,
    reviveAvatar
}