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
			(task) => {
				const queuedItem = task.media[0];
				const queuedContent = queuedItem.caption || queuedItem.text || '';
				return queuedItem.messageId === message.message_id ||
				(caption !== '#вагонетка_дня' &&
					queuedContent === caption &&
					(fileId
						? fileId === queuedItem.media
						: queuedItem.type === 'text'));
			}
		);

		if (isInQueue) {
			await sendReply(message, '❌ Сообщение уже в очереди.');
			return true;
		}

		return false;
	},
};
