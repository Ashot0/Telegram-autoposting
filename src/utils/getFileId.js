const { Markup } = require('telegraf');

// Функция для получения fileId медиафайлов
function getFileId(message) {
	const mediaType = ['photo', 'video', 'document', 'audio'].find(
		(type) => message[type]
	);
	if (!mediaType) return null;
	const mediaContent = message[mediaType];
	return Array.isArray(mediaContent)
		? mediaContent[mediaContent.length - 1].file_id
		: mediaContent.file_id;
}

module.exports = {
	getFileId,
};
