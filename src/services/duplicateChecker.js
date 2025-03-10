const { getFileId } = require('../utils/getFileId');
const { sendReply } = require('../services/Sends');

module.exports = {
	checkMessageDuplicate: async (message, queueManager) => {
		const fileId = getFileId(message);
		const caption = message.caption || message.text || '';

		if (fileId) {
			const isDuplicate = await queueManager.isMediaDuplicate(
				fileId,
				message.chat.id
			);
			if (isDuplicate) {
				await sendReply(message, '❌ Этот файл уже в очереди.');
				return true;
			}
		}

		const queue = await queueManager.getQueue();
		const isInQueue = queue.some(
			(task) =>
				task.media[0].messageId === message.message_id ||
				(caption !== '#вагонетка_дня' &&
					task.media[0].caption === caption &&
					fileId === task.media[0].fileId)
		);

		if (isInQueue) {
			await sendReply(message, '❌ Сообщение уже в очереди.');
			return true;
		}

		return false;
	},
};
