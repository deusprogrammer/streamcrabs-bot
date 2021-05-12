const { PubSubClient } = require('twitch-pubsub-client');
const { ApiClient } = require('twitch');
const { StaticAuthProvider } = require('twitch-auth');


let startListener = async (messageQueue, ws, context, plugins) => {
    const clientId = process.env.TWITCH_BOT_CLIENT_ID;
    const accessToken = context.botConfig.accessToken;
    const userId = context.botConfig.twitchChannelId;
    const authProvider = new StaticAuthProvider(clientId, accessToken);
    const apiClient = new ApiClient({ authProvider });

    // Setup pubsub listener
    const pubSubClient = new PubSubClient();
    await pubSubClient.registerUserListener(apiClient);
    console.log("* Redemption User registered");

    // Create pubsub listener
    pubSubClient.onRedemption(userId, async (message) => {
        let rewardName = message._data.data.redemption.reward.title;

        // console.log("* " + JSON.stringify(message, null, 5));
        console.log("* " + message.userName + " just redeemed " + message._data.data.redemption.reward.title);

        // Run through redemption plugin hooks
        for (let plugin of plugins) {
            plugin.redemptionHook(message, rewardName, messageQueue);
        }
    });

    return pubSubClient;
}

module.exports = {
    startListener
}