const { scheduleMessage } = require('../utils/scheduler');

const processScheduledMessage = (message, bot) => {
	const dateRegex = /(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2})/;
	const captionOrText = message.caption || message.text || '';
	const match = captionOrText.match(dateRegex);

	if (match) {
		scheduleMessage(message, match, null, bot);
		return true;
	}
	return false;
};

module.exports = { processScheduledMessage };
