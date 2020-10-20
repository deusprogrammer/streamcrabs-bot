const { PubSubClient } = require('twitch-pubsub-client');
const { ApiClient } = require('twitch');
const { StaticAuthProvider } = require('twitch-auth');

var Xhr = require('./xhr');

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
    battleAPCharge1: "d4bc34fb-c360-4655-863a-a3e310f17347",
    battleAPCharge10: "14b9e261-4d1a-4bfc-b55a-59913162ec73",
    battleAPCharge100: "0b2d8300-b0d8-4e30-a116-0f7d73fafc9a",
    battleAvatarCreate: "fb444b86-4e6c-4af8-ac75-518efb882e78",
    battleAvatarRevive: "84f19708-65f9-468e-9d0a-65ab9554014a"
}

let startListener = async (messageQueue) => {
    // Setup pubsub listener
    const pubSubClient = new PubSubClient();
    await pubSubClient.registerUserListener(apiClient)
    console.log("* User registered");

    // Create pubsub listener
    pubSubClient.onRedemption(userId, (message) => {
        console.log("* " + JSON.stringify(message, null, 5));
        console.log("* " + message.userName + " just redeemed " + message.rewardId);

        // Redemption switch
        switch (message.rewardId) {
            case commands.battleAvatarCreate:
                console.log("BATTLE AVATAR CREATED FOR " + message.userName);
                messageQueue.unshift({ target: "thetruekingofspace", text: `@${message.userName} created their battle avatar.` });
                Xhr.createUser(message);
                break;
            case commands.battleAPCharge1:
                console.log("AP + 1 FOR " + message.userName);
                messageQueue.unshift({ target: "thetruekingofspace", text: `@${message.userName} charged 1 AP.` });
                Xhr.chargeAP(message, 1);
                break;
            case commands.battleAPCharge10:
                console.log("AP + 10 FOR " + message.userName);
                messageQueue.unshift({ target: "thetruekingofspace", text: `@${message.userName} charged 10 AP.` });
                Xhr.chargeAP(message, 10);
                break;
            case commands.battleAPCharge100:
                console.log("AP + 100 FOR " + message.userName);
                messageQueue.unshift({ target: "thetruekingofspace", text: `@${message.userName} charged 100 AP.` });
                Xhr.chargeAP(message, 100);
                break;
            case commands.battleAvatarRevive:
                console.log("REVIVE REQUESTED FOR " + message.userName);
                messageQueue.unshift({ target: "thetruekingofspace", text: `@${message.userName} revived.` });
                Xhr.reviveAvatar(message);
                break;
        }
    });
}

module.exports = {
    startListener
}