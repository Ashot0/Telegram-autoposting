const schedule = require('node-schedule');
const moment = require('moment');
const { CHANNEL_ID, ADMIN_ID, TIME_ZONE } = require('./config');
const { sendMediaGroup, sendMessage, sendReply } = require('./Sends');

async function scheduleMessage(message, match, mediaGroupId, bot) {
	const [_, day, month, year, hour, minute] = match;
	const processedContent = message.caption?.replace(match[0], '').trim() || '';

	const sendDate = moment(
		`${year}-${month}-${day} ${hour}:${minute}`,
		'YYYY-MM-DD HH:mm'
	).utcOffset(TIME_ZONE, true);

	await sendReply(message, `⏳ Отправка сообщения в ${sendDate}`);

	const delay = sendDate.diff(moment(), 'milliseconds');

	if (delay > 0) {
		schedule.scheduleJob(sendDate.toDate(), async () => {
			if (mediaGroupId) {
				const groupMedia = mediaGroups.get(mediaGroupId);
				if (groupMedia?.length > 0) {
					await sendMediaGroup(groupMedia);
					setTimeout(() => {
						mediaGroups.delete(mediaGroupId);
					}, 5000);
				}
			} else {
				try {
					if (message.caption) {
						await sendMessage(
							message.chat.id,
							message.message_id,
							processedContent,
							message.caption_entities,
							message.show_caption_above_media,
							message.has_media_spoiler
						);
					} else if (message.text) {
						await bot.telegram.sendMessage(CHANNEL_ID, processedContent);
					}

					await bot.telegram.deleteMessage(message.chat.id, message.message_id);
				} catch (error) {
					console.error(`Ошибка при отправке по расписанию: ${error.message}`);
					await sendReply(message, `❌ Ошибка: ${error.message}`);
				}
			}
			await sendReply(message, '✅ Сообщение отправлено по расписанию!');
		});
	} else {
		await sendReply(message, '❌ Указанная дата уже прошла.');
	}
}

module.exports = {
	scheduleMessage,
};
