const test = require('node:test');
const assert = require('node:assert/strict');
const {
	createMediaItem,
	removeScheduleDate,
	sortAndNormalizeMediaGroup,
} = require('../mediaUtils');

test('media group is ordered by Telegram message_id and keeps its caption entities', () => {
	const customEmoji = {
		type: 'custom_emoji',
		offset: 0,
		length: 2,
		custom_emoji_id: 'premium-emoji-id',
	};
	const media = [
		{ type: 'photo', media: 'third', messageId: 12, caption: '🔥', caption_entities: [customEmoji] },
		{ type: 'photo', media: 'first', messageId: 10 },
		{ type: 'video', media: 'second', messageId: 11 },
	];

	const result = sortAndNormalizeMediaGroup(media);

	assert.deepEqual(result.map((item) => item.messageId), [10, 11, 12]);
	assert.equal(result[0].caption, '🔥');
	assert.deepEqual(result[0].caption_entities, [customEmoji]);
	assert.equal(result[1].caption, undefined);
	assert.equal(result[2].caption, undefined);
});

test('schedule date removal adjusts UTF-16 entity offsets and preserves custom emoji id', () => {
	const result = removeScheduleDate('02-08-2026 18:00 🔥 Новость', [
		{
			type: 'custom_emoji',
			offset: 17,
			length: 2,
			custom_emoji_id: 'premium-emoji-id',
		},
	]);

	assert.equal(result.text, '🔥 Новость');
	assert.deepEqual(result.entities, [
		{
			type: 'custom_emoji',
			offset: 0,
			length: 2,
			custom_emoji_id: 'premium-emoji-id',
		},
	]);
});

test('media item keeps the original caption entities from Telegram update', () => {
	const item = createMediaItem({
		message_id: 42,
		photo: [{ file_id: 'small' }, { file_id: 'large' }],
		caption: '🔥',
		caption_entities: [
			{ type: 'custom_emoji', offset: 0, length: 2, custom_emoji_id: 'emoji-id' },
		],
	});

	assert.equal(item.media, 'large');
	assert.equal(item.messageId, 42);
	assert.equal(item.caption_entities[0].custom_emoji_id, 'emoji-id');
});
