const { Markup } = require('telegraf');
const { ADMIN_ID } = require('../config');

const state = {
	isPaused: false,
	keyboardMessageId: null,
};

function getIsPaused() {
	return state.isPaused;
}

function getPauseKeyboard() {
	return Markup.inlineKeyboard([
		Markup.button.callback(
			getIsPaused() ? '▶️ Возобновить' : '⏸️ Пауза',
			'toggle_pause'
		),
	]);
}

async function sendPauseKeyboard(bot, adminId) {
	const text = getIsPaused()
		? '⏸️ Автопубликация приостановлена'
		: '▶️ Автопубликация активна';
	const keyboard = getPauseKeyboard();

	if (state.keyboardMessageId) {
		try {
			await bot.telegram.editMessageText(
				adminId,
				state.keyboardMessageId,
				null,
				text,
				keyboard
			);
			return;
		} catch (error) {
			if (!error.description?.includes('message to edit not found')) {
				throw error;
			}
		}
	}

	const message = await bot.telegram.sendMessage(adminId, text, keyboard);
	state.keyboardMessageId = message.message_id;
}

function togglePause() {
	state.isPaused = !state.isPaused;
	return state.isPaused;
}

function registerPauseHandlers(bot) {
	bot.action('toggle_pause', async (ctx) => {
		if (ctx.chat.id !== ADMIN_ID) {
			await ctx.answerCbQuery('Недостаточно прав');
			return;
		}
		togglePause();
		await ctx.answerCbQuery(
			getIsPaused() ? 'Пауза включена' : 'Отправка возобновлена'
		);
		await sendPauseKeyboard(bot, ctx.chat.id);
	});
}

module.exports = {
	getPauseKeyboard,
	sendPauseKeyboard,
	togglePause,
	registerPauseHandlers,
	getIsPaused,
};
