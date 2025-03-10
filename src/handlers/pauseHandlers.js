const { togglePause, sendPauseKeyboard } = require('../managers/pauseManager');

module.exports.handlePauseCommand = async (bot, ctx) => {
	togglePause();
	await sendPauseKeyboard(bot, ctx.message.chat.id);
	await ctx.deleteMessage();
};
