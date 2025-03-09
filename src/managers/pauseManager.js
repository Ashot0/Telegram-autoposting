const { Markup } = require('telegraf');
const { sendReply } = require('../services/Sends');
const { ADMIN_ID } = require('../config');

const state = {
	isPaused: false,
	keyboardMessageId: null,
};

function getIsPaused() {
	return state.isPaused;
}

function getPauseKeyboard() {
	return getIsPaused()
		? Markup.keyboard([['▶️ Возобновить']])
				.resize()
				.oneTime()
		: Markup.keyboard([['⏸️ Пауза']])
				.resize()
				.oneTime();
}

async function sendPauseKeyboard(bot, adminId) {
	const keyboard = getPauseKeyboard();
	try {
		if (state.keyboardMessageId) {
			await bot.telegram.editMessageText(
				adminId,
				state.keyboardMessageId,
				null,
				' ',
				{ reply_markup: keyboard.reply_markup }
			);
		} else {
			const msg = await bot.telegram.sendMessage(adminId, ' ', keyboard);
			state.keyboardMessageId = msg.message_id;
		}
	} catch (error) {
		if (error.description.includes('message to edit not found')) {
			const msg = await bot.telegram.sendMessage(adminId, ' ', keyboard);
			state.keyboardMessageId = msg.message_id;
		}
	}
}

function togglePause() {
	state.isPaused = !state.isPaused;
	sendReply(
		ADMIN_ID,
		state.isPaused ? '⏸️ Пауза активирована' : '▶️ Пауза деактивирована'
	);
}

function registerPauseHandlers(bot) {
	bot.action('toggle_pause', async (ctx) => {
		togglePause();
		const keyboard = Markup.inlineKeyboard([
			Markup.button.callback(
				getIsPaused() ? '▶️ Возобновить' : '⏸️ Пауза',
				'toggle_pause'
			),
		]);
		try {
			await ctx.editMessageReplyMarkup(keyboard.reply_markup);
			await sendPauseKeyboard(bot, ctx.chat.id);
		} catch (error) {
			console.error('Ошибка обновления:', error);
		}
	});
}

module.exports = {
	getPauseKeyboard,
	sendPauseKeyboard,
	togglePause,
	registerPauseHandlers,
	getIsPaused,
	set keyboardMessageId(id) {
		state.keyboardMessageId = id;
	},
};
