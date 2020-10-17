const tmi = require('tmi.js');

const Util = require('./util');
const Xhr = require('./xhr');
const Commands = require('./commands');
const Redemption = require('./redemption');

const BROADCASTER_NAME = "thetruekingofspace";

/*
 * INDEXES
 */

let itemTable = {};
let jobTable = {};
let abilityTable = {};
let encounterTable = {};
let cooldownTable = {};

let gameContext = {};

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

  // Connect to Twitch:
client.connect();

// Called every time a message comes in
async function onMessageHandler (target, context, msg, self) {
    if (self) { return; } // Ignore messages from the bot

    // let context = {itemTable, jobTable, monsterTable, abilityTable, encounterTable, cooldownTable};

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
            queue.unshift({target, text: "You must have a target for your attack."});
            return;
          }

          tokens[1] = tokens[1].replace("@", "").toLowerCase()

          if (cooldownTable[context.username]) {
            queue.unshift({target, text: `${context.username} is on cooldown.`});
            return;
          }

          var defenderName = tokens[1];
          var result = await Commands.attack(context.username, defenderName, gameContext);

          if (result.error) {
            queue.unshift({target, text: result.error});
            return;
          }

          // Set user cool down
          var normalizedDex = Math.min(5, result.attacker.dex);
          var actionCooldown = Math.min(11, 6 - normalizedDex);
          cooldownTable[context.username] = actionCooldown;

          queue.unshift({target, text: `${result.message}`});

          // Monster has died, remove from encounter table and reward the person who killed it.
          if (result.defender.hp <= 0  && defenderName.startsWith("~")) {
            delete encounterTable[result.defender.encounterTableKey];

            // Give drops to whoever delivered the final blow
            for (var i in result.defender.drops) {
              var drop = result.defender.drops[i];
              var chanceRoll = Util.rollDice("1d100");
              if (chanceRoll < drop.chance) {
                await Commands.giveItem("", context.username, drop.itemId);
                queue.unshift({target, text: `${context.username} found ${drop.itemId}`});
              }
            }
          }

          break;
        case "!transmog":
          if (context.username !== BROADCASTER_NAME && !context.mod) {
            return;
          }

          if (tokens.length < 2) {
            queue.unshift({target, text: "You must specify a target to turn into a slime"});
            return;
          }

          var transmogName = tokens[1];
          tokens[1] = tokens[1].replace("@", "").toLowerCase();

          if (tokens[1] === BROADCASTER_NAME) {
            return;
          }

          encounterTable[tokens[1].toLowerCase() + "_the_slime"] = {...monsterTable['SLIME'], transmogName, aggro: {}};

          queue.unshift({target, text: `${tokens[1]} was turned into a slime and will be banned upon death`});

          break;
        case "!untransmog":
          if (context.username !== BROADCASTER_NAME && !context.mod) {
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
        case "!spawn":
          if (context.username !== BROADCASTER_NAME && !context.mod) {
            return;
          }

          if (tokens.length < 2) {
            queue.unshift({target, text: "You must specify a monster to spawn"});
            return;
          }

          var monsterName = tokens[1].toLowerCase();
          var monster = monsterTable[monsterName.toUpperCase()];

          if (!monster) {
            queue.unshift({target, text: `${monsterName} is not a valid monster`});
            return;
          }

          var index = 0;
          while (encounterTable[monsterName + (++index)]);
          encounterTable[monsterName + index] = {...monster, aggro: {}, actionCooldown: Math.min(11, 6 - Math.min(5, monster.dex))};

          queue.unshift({target, text: `${monster.name} has appeared!`});

          break;
        case "!stats":
          var username = context.username;
          if (tokens[1]) {
            username = tokens[1].replace("@", "").toLowerCase();
          }

          var user = await Xhr.getUser(username);
          user = Util.expandUser(user, gameContext);
          queue.unshift({target, text: `[${user.name}] HP: ${user.hp} -- MP: ${user.mp} -- AP: ${user.ap} -- STR: ${user.str} -- DEX: ${user.dex} -- INT: ${user.int} -- HIT: ${user.hit} -- AC: ${user.totalAC}.`});
          break;
        case "!targets":
          var activeUsers = await Xhr.getActiveUsers();
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
            var results = await Commands.giveItemFromInventory(context.username, user, itemId, gameContext);

            if (results.error) {
              queue.unshift({target, text: results.error});
              return;
            }

            queue.unshift({target, text: results.message});
            return;
          }

          // Give as mod
          var results = await Commands.giveItem(context.username, user, itemId, target);

          if (results.error) {
            queue.unshift({target, text: results.error});
            return;
          }

          queue.unshift({target, text: results.message});

          break;
        case "!describe":
          if (tokens.length < 2) {
            queue.unshift({target, text: "Must provide an item name"});
            return;
          }

          tokens[1] = command.substring(Util.nthIndex(command, ' ', 1));
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
          queue.unshift({target, text: `Visit https://deusprogrammer.com/util/twitch to see how to use our in chat battle system and https://deusprogrammer.com/util/twitch/battlers/${context.username} for stats and equipment.`});
          break;
        case "!refresh":
          if (context.username !== BROADCASTER_NAME && !context.mod) {
            queue.unshift({target, text: "Only a mod or broadcaster can refresh the tables"});
            return;
          }

          itemTable    = await Xhr.getItemTable()
          jobTable     = await Xhr.getJobTable();
          monsterTable = await Xhr.getMonsterTable();
          abilityTable = await Xhr.getAbilityTable();

          gameContext = {itemTable, jobTable, monsterTable, abilityTable, encounterTable, cooldownTable};

          console.log(`* All tables refreshed`);

          queue.unshift({target, text: "All tables refreshed"});

          break;
        // case "!abilities":
        //   queue.unshift({target, text: `Currently these are the available abilities: "focus-attack".`});
        //   break;
        default:
          queue.unshift({target, text: `${tokens[0]} is an invalid command.`});
      }
    }
}

// Called every time the bot connects to Twitch chat
async function onConnectedHandler (addr, port) {
  console.log(`* Connected to ${addr}:${port}`);

  itemTable    = await Xhr.getItemTable()
  jobTable     = await Xhr.getJobTable();
  monsterTable = await Xhr.getMonsterTable();
  abilityTable = await Xhr.getAbilityTable();

  gameContext = {itemTable, jobTable, monsterTable, abilityTable, encounterTable, cooldownTable};

  console.log(`* All tables loaded`);

  // Queue consumer
  setInterval(() => {
    let message = queue.pop();
    if (message) {
      if (message.text.startsWith("/")) {
        client.say(message.target, message.text);
      } else {
        //client.say(message.target, "/me " + message.text + " >> [" + Util.randomUuid() + "]");
        client.say(message.target, "/me " + message.text);
      }
    }
  }, 2000);

  // Cooldown timer (all cooldowns have cool downs in increments of 15s)
  setInterval(() => {
    // Tick down human cooldowns
    Object.keys(cooldownTable).forEach(async (username) => {
      cooldownTable[username] -= 1;
      if (cooldownTable[username] <= 0) {
        delete cooldownTable[username];
        queue.unshift({target: "thetruekingofspace", text: `${username} can act again.`});
        return;
      }
    });

    // Do monster attacks
    Object.keys(encounterTable).forEach(async (encounterName) => {
      var encounter = encounterTable[encounterName];

      if (encounter.tick === undefined) {
        encounter.tick = 0;
      }

      if (encounter.tick === encounter.actionCooldown) {
        encounter.tick = 0;

        // Determine attack target.  If no aggro, pick randomly.  If aggro, pick highest damage dealt.
        var target = null;
        if (!encounter.aggro || Object.keys(encounter.aggro).length <= 0) {
          let activeUsers = await Xhr.getActiveUsers();
          target = activeUsers[Math.floor(Math.random() * Math.floor(activeUsers.length))];
        } else {
          Object.keys(encounter.aggro).forEach((attackerName) => {
            var attackerAggro = encounter.aggro[attackerName];
            if (target === null) {
              target = attackerName;
              return;
            }

            if (attackerAggro > encounter.aggro[target]) {
              target = attackerName;
            }
          });
        }

        if (target !== null) {
          var result = await Commands.attack("~" + encounterName, target, gameContext);

          if (result.error) {
            queue.unshift({target: "thetruekingofspace", text: result.error});
            return;
          }

          queue.unshift({target: "thetruekingofspace", text: `${result.message}`});
          return;
        }

        // Reset aggro between attacks
        encounter.aggro = {};
      }

      encounter.tick++;
    });
  }, 5 * 1000);

  // Advertising message
  setInterval(() => {
    queue.unshift({target: "thetruekingofspace", text: "Visit https://deusprogrammer.com/util/twitch to see how to use our in chat battle system."});
  }, 5 * 60 * 1000);

  queue.unshift({target: "thetruekingofspace", text: "I have restarted.  All monsters that were active are now gone."})

  // Start redemption listener
  Redemption.startListener(queue);
}