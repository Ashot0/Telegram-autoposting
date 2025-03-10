const { getFileId } = require('../utils/getFileId');
const { sendReply } = require('../services/Sends');
const { ADMIN_ID } = require('../config');

module.exports = function setupEditedMessageHandler(bot, queueManager) {
	bot.on('edited_message', async (ctx) => {
		if (ctx.chat.id !== ADMIN_ID) return;

		const editedMessage = ctx.update.edited_message;

		if (!editedMessage?.chat || editedMessage.chat.id !== ADMIN_ID) {
			console.error('[ERROR] editedMessage или chat не определены');
			return;
		}

		const messageId = editedMessage.message_id;

		try {
			const queue = await queueManager.getQueue();
			const taskIndex = queue.findIndex((task) =>
				task.media.some((media) => media.messageId === messageId)
			);

			if (taskIndex !== -1) {
				const task = queue[taskIndex];

				task.media.forEach((mediaItem) => {
					if (mediaItem.messageId === messageId) {
						mediaItem.caption =
							editedMessage.caption || editedMessage.text || '';
						mediaItem.fileId = getFileId(editedMessage);
						mediaItem.caption_entities = editedMessage.caption_entities || '';
						mediaItem.show_caption_above_media =
							editedMessage.show_caption_above_media || false;
						mediaItem.has_media_spoiler =
							editedMessage.has_media_spoiler || false;
					}
				});

				await queueManager.updateTask(task);
				await sendReply(ADMIN_ID, 'Сообщение обновлено в очереди.');
				console.log(`[EDITED] Сообщение ${messageId} обновлено в очереди.`);
			} else {
				console.log(
					`[ERROR] Редактированное сообщение ${messageId} не найдено в очереди.`
				);
			}
		} catch (error) {
			console.error('Ошибка при обработке редактирования:', error);
			await sendReply(
				ADMIN_ID,
				'❌ Ошибка при обновлении сообщения в очереди.'
			);
		}
	});
};
