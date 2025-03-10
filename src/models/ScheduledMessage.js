const mongoose = require('mongoose');

const scheduledMessageSchema = new mongoose.Schema(
	{
		sendDate: { type: Date, required: true },
		messageData: { type: mongoose.Schema.Types.Mixed, required: true },
		mediaGroupId: String,
		status: {
			type: String,
			enum: ['pending', 'sent', 'failed'],
			default: 'pending',
		},
		createdAt: { type: Date, default: Date.now },
	},
	{ collection: 'scheduled_messages' }
);

module.exports = mongoose.model('ScheduledMessage', scheduledMessageSchema);
