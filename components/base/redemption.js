const { PubSubClient } = require('twitch-pubsub-client');
const { ApiClient } = require('twitch');
const { StaticAuthProvider } = require('twitch-auth');


let startListener = async (messageQueue, context, plugins) => {
    const clientId = process.env.TWITCH_BOT_CLIENT_ID;
    const accessToken = context.botConfig.accessToken;
    const userId = context.botConfig.twitchChannelId;
    const authProvider = new StaticAuthProvider(clientId, accessToken);
    const apiClient = new ApiClient({ authProvider });

    // Setup pubsub listener
    const pubSubClient = new PubSubClient();
    await pubSubClient.registerUserListener(apiClient);
    console.log("* Redemption User registered");

    // Create pubsub subscription listener
    pubSubClient.onSubscription(userId, async (subMessage) => {
        let gifter = subMessage.gifterName;
        let giftee = subMessage.userName;
        let tier = subMessage.subPlan;
        let monthsSubbed = subMessage.months;

        // Run through subscription plugin hooks
        for (let plugin of plugins) {
            plugin.subscriptionHook(gifter, giftee, tier, monthsSubbed, messageQueue);
        }
    });

    // Create pubsub bits listener
    pubSubClient.onBits(userId, async (bitMessage) => {
        let bits = bitMessage.bits;
        let message = bitMessage.message;
        let userName = bitMessage.userName;

        // Run through bit plugin hooks
        for (let plugin of plugins) {
            plugin.bitsHook(bits, message, userName, messageQueue);
        }
    })

    // Create pubsub redemption listener
    pubSubClient.onRedemption(userId, async (redemptionMessage) => {
        let rewardName = redemptionMessage.rewardName;
        let userName = redemptionMessage.userName;
        let userId = redemptionMessage.userId;

        // Run through redemption plugin hooks
        for (let plugin of plugins) {
            plugin.redemptionHook(rewardName, userName, userId, messageQueue);
        }
    });

    return pubSubClient;
}

module.exports = {
    startListener
}