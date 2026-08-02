const SCHEDULE_DATE_REGEX = /(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2})/;

function getMediaType(message) {
	return ['photo', 'video', 'document', 'audio'].find((type) => message[type]);
}

function getFileId(message) {
	const mediaType = getMediaType(message);
	if (!mediaType) return null;

	const mediaContent = message[mediaType];
	return Array.isArray(mediaContent)
		? mediaContent[mediaContent.length - 1].file_id
		: mediaContent.file_id;
}

function createMediaItem(message) {
	const type = getMediaType(message);
	const media = getFileId(message);
	if (!type || !media) return null;

	const item = {
		type,
		media,
		messageId: message.message_id,
		has_media_spoiler: Boolean(message.has_media_spoiler),
	};

	if (message.caption !== undefined) {
		item.caption = message.caption;
		if (message.caption_entities?.length) {
			item.caption_entities = message.caption_entities;
		}
		if (message.show_caption_above_media !== undefined) {
			item.show_caption_above_media = message.show_caption_above_media;
		}
	}

	return item;
}

function sortAndNormalizeMediaGroup(media) {
	const sorted = media.map((item) => ({ ...item })).sort((a, b) => a.messageId - b.messageId);
	const captionItem = sorted.find((item) => item.caption !== undefined);
	const caption = captionItem
		? {
				text: captionItem.caption,
				entities: captionItem.caption_entities,
				showAbove: captionItem.show_caption_above_media,
			}
		: null;

	for (const item of sorted) {
		delete item.caption;
		delete item.caption_entities;
		delete item.show_caption_above_media;
	}

	if (caption && sorted[0]) {
		sorted[0].caption = caption.text;
		if (caption.entities?.length) {
			sorted[0].caption_entities = caption.entities;
		}
		if (caption.showAbove !== undefined) {
			sorted[0].show_caption_above_media = caption.showAbove;
		}
	}

	return sorted;
}

function removeScheduleDate(text, entities = []) {
	const match = text.match(SCHEDULE_DATE_REGEX);
	if (!match) return null;

	const removalStart = match.index;
	const removalEnd = removalStart + match[0].length;
	const withoutDate = text.slice(0, removalStart) + text.slice(removalEnd);
	const leadingWhitespace = withoutDate.match(/^\s*/)[0].length;
	const processedText = withoutDate.trim();

	const mapOffset = (offset) => {
		if (offset <= removalStart) return offset;
		if (offset >= removalEnd) return offset - (removalEnd - removalStart);
		return removalStart;
	};

	const processedEntities = entities
		.map((entity) => {
			const start = mapOffset(entity.offset) - leadingWhitespace;
			const end = mapOffset(entity.offset + entity.length) - leadingWhitespace;
			const clampedStart = Math.max(0, Math.min(processedText.length, start));
			const clampedEnd = Math.max(0, Math.min(processedText.length, end));
			return { ...entity, offset: clampedStart, length: clampedEnd - clampedStart };
		})
		.filter((entity) => entity.length > 0);

	return {
		match,
		text: processedText,
		entities: processedEntities,
	};
}

module.exports = {
	SCHEDULE_DATE_REGEX,
	createMediaItem,
	getFileId,
	removeScheduleDate,
	sortAndNormalizeMediaGroup,
};
