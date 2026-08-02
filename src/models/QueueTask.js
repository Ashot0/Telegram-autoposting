const mongoose = require('mongoose');
const { MONGODB_COLLECTION } = require('../config');

const mediaSchema = new mongoose.Schema({
	type: {
		type: String,
		required: true,
		enum: [
			'photo',
			'video',
			'document',
			'audio',
			'animation',
			'sticker',
			'voice',
			'video_note',
			'text',
		],
	},
	media: {
		type: String,
		required: function () {
			return this.type !== 'text'; // Для текста поле media не требуется
		},
	},
	messageId: { type: Number, required: true },
	text: { type: String },
	entities: { type: mongoose.Schema.Types.Mixed },
	caption: { type: String },
	caption_entities: { type: mongoose.Schema.Types.Mixed },
	show_caption_above_media: { type: Boolean },
	has_media_spoiler: { type: Boolean },
});

const queueTaskSchema = new mongoose.Schema(
	{
		chatId: { type: Number, required: true },
		media: { type: [mediaSchema], required: true },
		mediaGroupId: {
			type: String,
			index: {
				name: 'mediaGroupId_unique',
				unique: true,
				sparse: true,
			},
		},
		createdAt: { type: Date, default: Date.now },
		status: {
			type: String,
			enum: ['pending', 'processing', 'sent'],
			default: 'pending',
			index: true,
		},
		processingStartedAt: { type: Date },
	},
	{ collection: MONGODB_COLLECTION }
);

module.exports = mongoose.model('QueueTask', queueTaskSchema);
