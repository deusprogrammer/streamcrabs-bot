const flaggedUsers = {};

const handleItemGive = async (item, giver, receiver) => {
    if (item.name.startsWith("Miku's")) {
        if (receiver.name !== "miku_the_space_bot") {
            client.say(botConfig.twitchChannel, `WHY ARE YOU TRADING THOSE?!  My ${item.name.replace("Miku's", "").toLowerCase()} aren't Pokemon cards >_<!`);
            flaggedUsers[receiver.name] = true;
            flaggedUsers[giver.name] = true;
        } else {
            let username = giver.name;
            let mikusThings = await gatherMikusThings(username);
            if (mikusThings.length > 0) {
                client.say(botConfig.twitchChannel, `Oh, ${username}...you're giving these back?  Hmmmmm...are you sure you don't have something else of mine...like my ${mikusThings.map(name => name.replace("Miku's", "").toLowerCase())[0]}.`);
            } else {
                client.say(botConfig.twitchChannel, `Oh, ${username}...you're giving these back?  Hmmmmm...I guess I forgive you...baka.`);
                flaggedUsers[giver.name] = false;
            }
        }
    } else if (item.type === "gift" && item.slot === "miku") {
        // Handle giving gifts to Miku
        client.whisper(giver.name, `Thanks for the ${item.name}...I'll remember this in the future.`);

        // TODO Create a luck table or something
    } else if (item.type === "sealed") {
        // Handle giving sealed item to Miku
        let sealedItem = await Xhr.getSealedItem(item.sealedItemId);

        if (sealedItem.owningChannel != TWITCH_EXT_CHANNEL_ID) {
            client.whisper(giver.name, `This sealed box is meant for another channel...you shouldn't have been able to get this.  Please contact deusprogrammer@gmail.com to let them know you have found a bug.`);
            return;
        }
        
        if (!sealedItem || sealedItem.claimed) {
            client.whisper(giver.name, `Huh...this box is empty.  That's weird.  Reach out to the streamer for assistance.`);
            return;
        }
        client.whisper(giver.name, `Congratulations!  You got a ${sealedItem.name}!  ${sealedItem.description}.  The code is: ${sealedItem.code}`);
        sealedItem.claimed = true;
        sealedItem.claimedBy = giver.name;
        await Xhr.updateSealedItem(sealedItem);
    }
}

const gatherMikusThings = async (username) => {
    let user = await Commands.getTarget(username, gameContext);
    let mikusItems = Object.keys(user.inventory).map(key => user.inventory[key].name).filter(itemName => itemName.startsWith("Miku's"));
    let mikusEquip = Object.keys(user.equipment).map(key => user.equipment[key].name).filter(itemName => itemName.startsWith("Miku's"));
    let mikusItemsAll = [...mikusItems, ...mikusEquip];
    
    return mikusItemsAll;
}
 
const mikuEventHandler = async (client, event) => {
    // If the user get's an item that belong's to Miku, have her react
    if (event.type === "ITEM_GET" && event.eventData.results.item.name.startsWith("Miku's")) {
        client.say(botConfig.twitchChannel, `W...wait!  Give back my ${event.eventData.results.item.name.replace("Miku's", "").toLowerCase()} >//<!`);
        flaggedUsers[event.eventData.results.receiver.name] = true;
    } else if (event.type === "ITEM_GIVE") {
        handleItemGive(event.eventData.results.item, event.eventData.results.giver, event.eventData.results.receiver);
    } else if (event.type === "ITEM_GIFT" && event.eventData.results.item.name.startsWith("Miku's")) {
        client.say(botConfig.twitchChannel, `WHERE DID YOU GET THOSE?!  I don't think I'm missing my ${event.eventData.results.item.name.replace("Miku's", "").toLowerCase()}...OMFG...WHERE DID THEY GO O//O;?`);
        flaggedUsers[event.eventData.results.receiver.name] = true;
        flaggedUsers[event.eventData.results.giver.name] = true;
    } else if (event.type === "JOIN") {
        let username = event.eventData.results.attacker.name;
        let mikusThings = await gatherMikusThings(username);
        if (mikusThings.length > 0) {
            client.say(botConfig.twitchChannel, `I see you still have my ${mikusThings.map(name => name.replace("Miku's", "").toLowerCase())[0]} and probably other things...hentai.`);
            flaggedUsers[username] = true;
        }
    }
}

exports.mikuEventHandler = mikuEventHandler;