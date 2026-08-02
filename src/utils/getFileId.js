const MEDIA_TYPES = [
	'photo',
	'video',
	'document',
	'audio',
	'animation',
	'sticker',
	'voice',
	'video_note',
];

function getMediaType(message) {
	return MEDIA_TYPES.find((type) => message[type]);
}

// Функция для получения fileId медиафайлов
function getFileId(message) {
	const mediaType = getMediaType(message);
	if (!mediaType) return null;
	const mediaContent = message[mediaType];
	return Array.isArray(mediaContent)
		? mediaContent[mediaContent.length - 1].file_id
		: mediaContent.file_id;
}

module.exports = {
	getFileId,
	getMediaType,
};
