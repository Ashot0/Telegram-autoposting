const { getFileId } = require('../utils/getFileId');
const { handlePauseCommand } = require('./pauseHandlers');
const { processScheduledMessage } = require('./scheduleHandler');
const {
	processMediaGroup,
	processMediaMessage,
	processTextMessage,
} = require('./mediaHandler');
const duplicateChecker = require('../services/duplicateChecker');
const { ADMIN_ID, SEND_COOLDOWN } = require('../config');

module.exports = (bot, queueManager) => {
	bot.on('message', async (ctx) => {
		if (ctx.chat.id !== ADMIN_ID) return;

		console.log('Получено сообщение:', ctx.message);

		const { message } = ctx;
		const text = message.text;

		// Обработка команд паузы
		if (text === '⏸️ Пауза' || text === '▶️ Возобновить') {
			await handlePauseCommand(bot, ctx);
			return;
		}

		setTimeout(async () => {
			const mediaGroupId = message.media_group_id;
			const caption = message.caption || text || '';

			// Проверка дубликатов
			if (await duplicateChecker.checkMessageDuplicate(message, queueManager)) {
				await ctx.deleteMessage();
				return;
			}

			// Обработка отложенных сообщений
			if (processScheduledMessage(message, bot)) return;

			// Обработка медиагрупп
			if (mediaGroupId) {
				await processMediaGroup(message, mediaGroupId, queueManager);
				return;
			}

			// Обработка одиночных медиа
			const fileId = getFileId(message);
			if (fileId) {
				await processMediaMessage(message, fileId, queueManager);
				return;
			}

			// Обработка текстовых сообщений
			if (text) {
				await processTextMessage(message, queueManager);
			}
		}, SEND_COOLDOWN);
	});
};
