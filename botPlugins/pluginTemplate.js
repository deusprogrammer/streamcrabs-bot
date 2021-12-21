const EventQueue = require('../components/base/eventQueue');

exports.commands = {
    "!echo": async (twitchContext, botContext) => {
        EventQueue.sendInfoToChat(`Hello ${twitchContext.username}.  You said ${twitchContext.text} on ${botContext.botConfig.twitchUser}'s channel.`);
    }
}
exports.init = async (botContext) => {}
exports.bitsHook = async ({bits, userName, userId}, botContext) => {}
exports.subscriptionHook = async ({userName, userId, subPlan}, botContext) => {}
exports.followHook = async ({userId, userName}, botContext) => {}
exports.redemptionHook = async ({rewardTitle, userName, userId}, botContext) => {}
exports.onWsMessage = async (event, ws, botContext) => {}
exports.wsInitHook = (from) => {}