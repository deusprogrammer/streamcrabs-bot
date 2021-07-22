const { PubSubClient } = require('twitch-pubsub-client');
const { ApiClient } = require('twitch');
const { StaticAuthProvider, RefreshableAuthProvider } = require('twitch-auth');


let startListener = async (messageQueue, context, plugins) => {
    const clientId = process.env.TWITCH_BOT_CLIENT_ID;
    const accessToken = context.botConfig.accessToken;
    const userId = context.botConfig.twitchChannelId;
    const authProvider = new StaticAuthProvider(clientId, accessToken, ["channel:read:redemptions", "channel:read:subscriptions", "bits:read", "channel_subscriptions"], "user");
    const apiClient = new ApiClient({ authProvider });

    // Setup pubsub listener
    const pubSubClient = new PubSubClient();
    await pubSubClient.registerUserListener(apiClient);
    console.log("* Redemption User registered");

    // Create pubsub subscription listener
    pubSubClient.onSubscription(userId, async (subMessage) => {
        try {
            let gifter = subMessage.gifterName;
            let gifterId = subMessage.gifterId;
            let giftee = subMessage.userName;
            let gifteeId = subMessage.userId;
            let tier = subMessage.subPlan;
            let monthsSubbed = subMessage.months;

            // Run through subscription plugin hooks
            for (let plugin of plugins) {
                plugin.subscriptionHook(gifter, gifterId, giftee, gifteeId, tier, monthsSubbed, messageQueue, context);
            }
        } catch (error) {
            console.error("SUB FAILURE: " + error);
        }
    });

    // Create pubsub bits listener
    pubSubClient.onBits(userId, async (bitMessage) => {
        try {
            let bits = bitMessage.bits;
            let message = bitMessage.message;
            let userName = bitMessage.userName;
            let userId = bitMessage.userId;

            // Run through bit plugin hooks
            for (let plugin of plugins) {
                plugin.bitsHook(bits, message, userName, userId, messageQueue, context);
            }
        } catch (error) {
            console.error("BIT FAILURE: " + error);
        }
    })

    // Create pubsub redemption listener
    pubSubClient.onRedemption(userId, async (redemptionMessage, botContext) => {
        try {
            let rewardName = redemptionMessage.rewardName;
            let userName = redemptionMessage.userName;
            let userId = redemptionMessage.userId;

            // Run through redemption plugin hooks
            for (let plugin of plugins) {
                plugin.redemptionHook(rewardName, userName, userId, messageQueue, context);
            }
        } catch (error) {
            console.error("REDEMPTION FAILURE: " + error);
        }
    });

    return pubSubClient;
}

module.exports = {
    startListener
}