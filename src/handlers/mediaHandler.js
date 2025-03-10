const { sendReplyWithDeleteButton } = require('../services/Sends');
const { getFileId } = require('../utils/getFileId');

module.exports.processMediaGroup = async (
	message,
	mediaGroupId,
	queueManager
) => {
	if (!queueManager.mediaGroups.has(mediaGroupId)) {
		queueManager.mediaGroups.set(mediaGroupId, []);
	}

	queueManager.mediaGroups.get(mediaGroupId).push({
		type: ['photo', 'video', 'document', 'audio'].find((type) => message[type]),
		media: getFileId(message),
		messageId: message.message_id,
		caption: message.caption,
		caption_entities: message.caption_entities,
		show_caption_above_media: message.show_caption_above_media,
		has_media_spoiler: message.has_media_spoiler || false,
	});

	if (queueManager.mediaGroups.get(mediaGroupId).length === 1) {
		await queueManager.processMediaGroup(message, mediaGroupId);
	}
};

module.exports.processMediaMessage = async (message, fileId, queueManager) => {
	await queueManager.addToQueue({
		chatId: message.chat.id,
		media: [
			{
				type: ['photo', 'video', 'document', 'audio'].find(
					(type) => message[type]
				),
				media: fileId,
				messageId: message.message_id,
				caption: message.caption,
				caption_entities: message.caption_entities,
				show_caption_above_media: message.show_caption_above_media,
				has_media_spoiler: message.has_media_spoiler || false,
			},
		],
	});
	await sendReplyWithDeleteButton(message, '✅ Медиафайл добавлен в очередь.');
};

module.exports.processTextMessage = async (message, queueManager) => {
	await queueManager.addToQueue({
		chatId: message.chat.id,
		media: [
			{
				type: 'text',
				messageId: message.message_id,
				text: message.text,
				caption: message.caption,
				caption_entities: message.caption_entities,
				show_caption_above_media: message.show_caption_above_media,
			},
		],
	});
	await sendReplyWithDeleteButton(message, '✅ Сообщение добавлено в очередь.');
};
