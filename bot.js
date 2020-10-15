const axios = require('axios');

const tmi = require('tmi.js');

const { PubSubClient } = require('twitch-pubsub-client');
const { ApiClient } = require('twitch');
const { StaticAuthProvider } = require('twitch-auth');

const BROADCASTER_NAME = "thetruekingofspace";
const BATTLE_API_URL = process.env.BATTLE_API_URL;
const PROFILE_API_URL = process.env.PROFILE_API_URL;
const BATTLE_BOT_JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyIjp7Il9pZCI6IjVmN2NmZjY0NTk1OWY3MDAxNDFjYjhhMSIsInVzZXJuYW1lIjoibWlrdV90aGVfc3BhY2VfYm90Iiwicm9sZXMiOlsiVFdJVENIX0JPVCJdLCJjb25uZWN0ZWQiOnsidHdpdGNoIjp7fX19LCJpYXQiOjE2MDIwMzU3MjB9.hywhuHwhr3KMePkh3XP6K3dg8iFksZCJIaXmdzBnh7Y';

console.log("BATTLE API URL:  " + BATTLE_API_URL);
console.log("PROFILE API URL: " + PROFILE_API_URL);

/*
 * INDEXES
 */

let itemTable = {};
let jobTable = {};
let encounterTable = {};

/*
 * LOGIC
*/

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

const indexArrayToMap = (array) => {
  let table = {};
  array.forEach((element) => {
    table[element.id] = element;
  });

  return table;
}

const getItemTable = () => {
  return axios.get(`${BATTLE_API_URL}/items`, {
    headers: {
      Authorization: `Bearer ${BATTLE_BOT_JWT}`
    }
  })
    .then((response) => {
      return indexArrayToMap(response.data);
    })
}

const getJobTable = () => {
  return axios.get(`${BATTLE_API_URL}/jobs`, {
    headers: {
      Authorization: `Bearer ${BATTLE_BOT_JWT}`
    }
  })
    .then((response) => {
      return indexArrayToMap(response.data);
    })
}

const expandUser = (userData) => {
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

const getUser = async (username, expand = true) => {
  try {
    let userResponse = await axios.get(`${BATTLE_API_URL}/users/${username}`, {
      headers: {
        Authorization: `Bearer ${BATTLE_BOT_JWT}`
      }
    })

    if (!expand) {
      return userResponse.data;
    }

    return expandUser(userResponse.data);
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
      password: randomUuid(),
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

  if (user.hp < 0) {
    return Promise.resolve();
  }

  user.hp = 100;

  await updateUser(user);
}

/* 
 * REDEMPTION BOT
*/

// Setup Twitch API Client
const clientId = 'gp762nuuoqcoxypju8c569th9wz7q5';
const accessToken = 'tc2co2bd341sjktegsa5ut3a5qn51b';
const authProvider = new StaticAuthProvider(clientId, accessToken);
const apiClient = new ApiClient({ authProvider });
const userId = "88666502";

const commands = {
    battleAPCharge1:     "d4bc34fb-c360-4655-863a-a3e310f17347",
    battleAPCharge10:    "14b9e261-4d1a-4bfc-b55a-59913162ec73",
    battleAPCharge100:   "0b2d8300-b0d8-4e30-a116-0f7d73fafc9a",
    battleAvatarCreate:  "fb444b86-4e6c-4af8-ac75-518efb882e78",
    battleAvatarRevive:  "84f19708-65f9-468e-9d0a-65ab9554014a"
}

// Setup pubsub listener
const pubSubClient = new PubSubClient();
pubSubClient.registerUserListener(apiClient).then(() => {
  console.log("* User registered");

  // Create pubsub listener
  pubSubClient.onRedemption(userId, (message) => {
    console.log("* " + JSON.stringify(message, null, 5));
    console.log("* " + message.userName + " just redeemed " + message.rewardId);

    // Redemption switch
    switch (message.rewardId) {
      case commands.battleAvatarCreate:
        console.log("BATTLE AVATAR CREATED FOR " + message.userName);
        queue.unshift({target: "thetruekingofspace", text: `@${message.userName} created their battle avatar.`});
        createUser(message);
        break;
      case commands.battleAPCharge1:
        console.log("AP + 1 FOR " + message.userName);
        queue.unshift({target: "thetruekingofspace", text: `@${message.userName} charged 1 AP.`});
        chargeAP(message, 1);
        break;
      case commands.battleAPCharge10:
        console.log("AP + 10 FOR " + message.userName);
        queue.unshift({target: "thetruekingofspace", text: `@${message.userName} charged 10 AP.`});
        chargeAP(message, 10);
        break;
      case commands.battleAPCharge100:
        console.log("AP + 100 FOR " + message.userName);
        queue.unshift({target: "thetruekingofspace", text: `@${message.userName} charged 100 AP.`});
        chargeAP(message, 100);
        break;
      case commands.battleAvatarRevive:
        console.log("REVIVE REQUESTED FOR " + message.userName);
        queue.unshift({target: "thetruekingofspace", text: `@${message.userName} revived.`});
        reviveAvatar(message);
        break;
    }
  });
});

/* 
* CHAT BOT 
*/

let queue = [];

// Define configuration options for chat bot
const opts = {
  identity: {
    username: "miku_the_space_bot",
    password: "oauth:k4gkyf9djs2atzzb4yr0zzrglc5hg2"
  },
  channels: [
    "thetruekingofspace"
  ]
};

// Create a client with our options
const client = new tmi.client(opts);

// Register our event handlers (defined below)
client.on('message', onMessageHandler);
client.on('connected', onConnectedHandler);
client.on("join", onJoin);

getItemTable()
  .then((items) => {
    itemTable = items;
    return getJobTable();
  })
  .then((jobs) => {
    jobTable = jobs;

    // Connect to Twitch:
    client.connect();
  });

const battle = async (attackerName, defenderName, ability, target) => {
  try {
    let attacker = await getUser(attackerName);

    if (attacker.hp <= 0) {
      queue.unshift({target, text: `@${attackerName} is dead and cannot perform any actions.`});
      return Promise.reject("User is dead");
    } else if (attacker.ap <= 0) {
      attacker.ap = 0;
      queue.unshift({target, text: `@${attackerName} is out of action points and cannot perform any actions.`});
      return Promise.reject("User is out of AP");
    }

    let targets = await getActiveUsers();

    let defender = {}
    let isMonster = false;

    if (defenderName.startsWith("~")) {
      defenderName = defenderName.substring(1);
      defender = encounterTable[defenderName];
      isMonster = true;
    } else {
      defender = await getUser(defenderName);
    }

    if (defender && !targets.includes(defenderName) && !encounterTable[defenderName]) {
      queue.unshift({target, text: `@${defenderName}'s not here man!`});
      return Promise.reject("User is out of AP");
    }
    
    if (!defender) {
      queue.unshift({target, text: `There is not such target ${defenderName}`});
      return Promise.reject("Target doesn't exist");
    }

    if (defender.hp <= 0) {
      queue.unshift({target, text: `@${defenderName} is already dead.`});
      return Promise.reject("Target is already dead");
    }

    if (ability === "attack") {
      let weapon = attacker.equipment.hand;
      let ac = defender.totalAC + defender.currentJob.dex;
      let armorAc = defender.totalAC;

      let attackRoll = rollDice("1d20");
      let modifiedAttackRoll = attackRoll + attacker.currentJob.str;

      let damage = 0;
      let resultText = "";
      if (modifiedAttackRoll >= ac || attackRoll === 20 ) {
        damage = rollDice(weapon.dmg) + attacker.currentJob.str;
        if (attackRoll === 20) {
          damage *= 2;
        }

        if (defender.hp <= damage) {
          resultText = `@${defender.name} has died!`;
          // If the monster is a transmogged user, ban them on death.
          if (defender.transmogName) {
            queue.unshift({target, text: `/ban ${defender.transmogName}`});
          }
        } else {
          resultText = `@${defender.name} has ${defender.hp - damage} HP left.`;
        }
        if (attackRoll === 20) {
          queue.unshift({target, text: `SMAAAASH!  @${attacker.name} rolled a ${modifiedAttackRoll} and scored a critical hit on @${defender.name} and hit for ${damage} damage. ${resultText}`});
        } else {
          queue.unshift({target, text: `@${attacker.name} rolled a ${modifiedAttackRoll} against @${defender.name}'s ${ac} AC and hit for ${damage} damage. ${resultText}`});        
        }
      } else if (modifiedAttackRoll <= armorAc) {
        queue.unshift({target, text: `@${attacker.name} rolled a ${modifiedAttackRoll} against @${defender.name}'s ${ac} AC and hits, but failed to penetrate their armor. ${resultText}`});
      } else {
        queue.unshift({target, text: `@${attacker.name} rolled a ${modifiedAttackRoll} against @${defender.name}'s ${ac} AC and misses as @${defender.name} dodges away. ${resultText}`});
      }

      // Get current, unexpanded version
      attacker = await getUser(attacker.name, false);
      if (!isMonster) {
        defender = await getUser(defender.name, false);
      }

      attacker.ap -= 1;
      defender.hp -= damage;
    } else if (ability === "focus-attack") {
      let weapon = attacker.equipment.hand;
      let ac = defender.totalAC + defender.currentJob.dex;
      let armorAc = defender.totalAC;

      let attackRoll = rollDice("2d20");
      let modifiedAttackRoll = attackRoll + attacker.currentJob.str;

      let damage = 0;
      let resultText = "";
      if (modifiedAttackRoll >= ac || attackRoll === 20 ) {
        damage = rollDice(weapon.dmg) + (2 * attacker.currentJob.str);

        if (defender.hp <= damage) {
          resultText = `@${defender.name} has died!`;
          // If the monster is a transmogged user, ban them on death.
          if (defender.transmogName) {
            queue.unshift({target, text: `/ban ${defender.transmogName}`});
          }
        } else {
          resultText = `@${defender.name} has ${defender.hp - damage} HP left.`;
        }

        queue.unshift({target, text: `@${attacker.name} focused, rolled a ${modifiedAttackRoll} against @${defender.name}'s ${ac} AC, and hit for ${damage} damage. ${resultText}`});        
      } else if (modifiedAttackRoll <= armorAc) {
        queue.unshift({target, text: `@${attacker.name} focused, rolled a ${modifiedAttackRoll} against @${defender.name}'s ${ac} AC, and hits, but failed to penetrate their armor. ${resultText}`});
      } else {
        queue.unshift({target, text: `@${attacker.name} focused, rolled a ${modifiedAttackRoll} against @${defender.name}'s ${ac} AC, and misses as @${defender.name} dodges away. ${resultText}`});
      }

      // Get current, unexpanded version
      attacker = await getUser(attacker.name, false);
      if (!isMonster) {
        defender = await getUser(defender.name, false);
      }

      attacker.ap -= 2;
      defender.hp -= damage;
    }

    // Update attacker and target stats
    await updateUser(attacker);
    if (isMonster) {
      encounterTable[`~${defenderName}`] = defender;
    } else {
      await updateUser(defender);
    }
  } catch (e) {
    console.error("Failed to run battle!  " + e);
  }
}

const giveItem = async (giverName, username, itemId, target) => {
  let user = await getUser(username, false);
  let item = await getItem(itemId);

  if (!user) {
    queue.unshift({target, text: `No user named ${username} found`}); 
    return;
  }

  if (!item) {
    queue.unshift({target, text: `No item with item id ${itemId} found`}); 
    return;
  }

  user.inventory.push(itemId);

  await updateUser(user);

  queue.unshift({target, text: `${giverName} gave ${username} a ${item.name}`}); 
}

const giveItemFromInventory = async (giverName, username, itemId, target) => {
  let giver = await getUser(giverName, false);
  let user = await getUser(username, false);
  let item = await getItem(itemId);

  if (!giver) {
    queue.unshift({target, text: `No user named ${username} found`});
    return;
  }

  if (!user) {
    queue.unshift({target, text: `No user named ${username} found`}); 
    return;
  }

  if (!item) {
    queue.unshift({target, text: `No item with item id ${itemId} found`}); 
    return;
  }

  let index = giver.inventory.indexOf(itemId);

  if (index < 0) {
    queue.unshift({target, text: `${giverName} has no ${item.name} to give`}); 
    return;
  }

  giver.inventory.splice(index, 1);
  user.inventory.push(itemId);

  await updateUser(giver);
  await updateUser(user);

  queue.unshift({target, text: `${giver} gave ${username} a ${item.name}`}); 
}

const getStats = async (username, target) => {
  let user = await getUser(username)
  console.log(`USER: ${JSON.stringify(user, null, 5)}`);
  queue.unshift({target, text: `[@${user.name} Stats] HP: ${user.hp} -- MP: ${user.mp} -- AP: ${user.ap} -- STR: ${user.currentJob.str} -- DEX: ${user.currentJob.dex} -- INT: ${user.currentJob.int} -- AC: ${user.totalAC + user.currentJob.dex}`});
  queue.unshift({target, text: `You can also find stats for your user and change equipment at https://deusprogrammer.com/util/twitch/battlers/~self`}); 
}

// Called every time someone joins the channel
async function onJoin(channel, username, self) {
  let activeUsers = await getActiveUsers();

  if (activeUsers.includes(username.toLowerCase())) {
    queue.unshift({channel, text: `Welcome back ${username}!`});
    return;
  }

  queue.unshift({channel, text: `Welcome ${username}!  Visit https://deusprogrammer.com/util/twitch to see how to use our in chat battle system.`});
}

// Called every time a message comes in
async function onMessageHandler (target, context, msg, self) {
    if (self) { return; } // Ignore messages from the bot

    console.log(JSON.stringify(context, null, 5));

    // Remove whitespace from chat message
    const command = msg.trim();

    // Handle battle commands here
    if (command.startsWith("!")) {
      var tokens = command.split(" ");

      console.log("Received command!")
      console.log("Tokens: " + tokens);

      switch(tokens[0]) {
        case "!attack":
          if (tokens.length < 2) {
            queue.unshift({target, text: "You must have a target for your attack"});
            return;
          }

          tokens[1] = tokens[1].replace("@", "").toLowerCase()

          var defenderName = tokens[1];
          battle(context.username, defenderName, "attack", target);
          break;
        case "!ability":
          if (tokens.length < 3) {
            queue.unshift({target, text: "You must specify the ability and target for your attack"});
            return;
          }

          var ability = tokens[1];
          var defenderName = tokens[2].replace("@", "").toLowerCase();
          battle(context.username, defenderName, ability, target);
          break;
        case "!transmog":
          if (context.username !== BROADCASTER_NAME && !context.mod) {
            queue.unshift({target, text: "Only a mod or broadcaster can transmogrify a chatter"});
            return;
          }

          if (tokens.length < 2) {
            queue.unshift({target, text: "You must specify a target to turn into a slime"});
            return;
          }

          var transmogName = tokens[1];
          tokens[1] = tokens[1].replace("@", "").toLowerCase();

          var chatters = await getChatters();

          if (!chatters.includes(tokens[1])) {
            queue.unshift({target, text: `${tokens[1]}'s not here man`});
            return;
          }

          if (tokens[1] === BROADCASTER_NAME) {
            queue.unshift({target, text: "You can't transmog the broadcaster"});
            return;
          }

          encounterTable[tokens[1].toLowerCase() + "_the_slime"] = {
            name: tokens[1] + "_the_slime",
            hp: 20,
            ap: 10,
            totalAC: 6,
            transmogName,
            currentJob: {
              id: "SLIME",
              str: -1,
              dex: 0,
              int: -1
            },
            equipment: {
              hand: {
                dmg: "1d4"
              }
            },
            drops: [
              {
                name: "POTION",
                chance: 100
              }
            ]
          }

          queue.unshift({target, text: `${tokens[1]} was turned into a slime and will be banned upon death`});

          break;
        case "!untransmog":
          if (context.username !== BROADCASTER_NAME && !context.mod) {
            queue.unshift({target, text: "Only a mod or broadcaster can transmogrify a chatter"});
            return;
          }

          if (tokens.length < 2) {
            queue.unshift({target, text: "You must specify a target to revert from a slime"});
            return;
          }

          var transmogName = tokens[1];
          tokens[1] = tokens[1].replace("@", "").toLowerCase();

          var monsterName = tokens[1].toLowerCase() + "_the_slime";

          if (!encounterTable[monsterName]) {
            queue.unshift({target, text: `${tokens[1]} isn't a slime`});
            return;
          }

          delete encounterTable[monsterName];

          queue.unshift({target, text: `${tokens[1]} was reverted from a slime`});

          break;
        case "!stats":
          var username = context.username;
          if (tokens[1]) {
            username = tokens[1].replace("@", "").toLowerCase();
          }
          getStats(username, target);
          break;
        case "!targets":
          var activeUsers = await getActiveUsers();
          var monsterList = Object.keys(encounterTable).map((name) => {
            return `~${name}`;
          });
          queue.unshift({target, text: `Available targets are: ${[...activeUsers, ...monsterList]}`});
          break;
        case "!give":
          if (tokens.length < 3) {
            queue.unshift({target, text: "Must provide a target and an item id to give"});
            return;
          }

          user = tokens[1].replace("@", "").toLowerCase();
          var itemId = tokens[2];

          // Give from inventory if not a mod
          if (context.username !== BROADCASTER_NAME && !context.mod) {
            giveItemFromInventory(context.username, user, itemId, target);
            return;
          }

          // Give as mod
          giveItem(context.username, user, itemId, target);

          break;
        case "!describe":
          if (tokens.length < 2) {
            queue.unshift({target, text: "Must provide an item name"});
            return;
          }

          tokens[1] = command.substring(nthIndex(command, ' ', 1));
          var found = Object.keys(itemTable).filter((element) => {
            var item = itemTable[element];
            return item.name === tokens[1];
          });

          if (found.length < 1) {
            queue.unshift({target, text: `Cannot find item ${tokens[1]}`});
            return;
          }

          found = itemTable[found[0]];
          queue.unshift({target, text: `${found.name} is a ${found.type} and has a trade id of ${found.id}`});
          break;
        case "!help":
          queue.unshift({target, text: "Visit https://deusprogrammer.com/util/twitch to see how to use our in chat battle system."});
          break;
        case "!abilities":
          queue.unshift({target, text: `Currently these are the available abilities: "focus-attack".`});
          break;
      }
    }
}

// Called every time the bot connects to Twitch chat
function onConnectedHandler (addr, port) {
  console.log(`* Connected to ${addr}:${port}`);

  setInterval(() => {
    let message = queue.pop();
    if (message) {
      client.say(message.target, "/me " + message.text + " >> [" + randomUuid() + "]");
    }
  }, 2000);
}