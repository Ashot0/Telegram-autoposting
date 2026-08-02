const schedule = require('node-schedule');
const moment = require('moment-timezone'); // Изменено на moment-timezone
const { CHANNEL_ID, ADMIN_ID } = require('../config'); // TIME_ZONE больше не нужен
const {
	sendMediaGroup,
	sendMessage,
	sendTextMessage,
	sendReply,
} = require('../services/Sends');
const ScheduledMessage = require('../models/ScheduledMessage');

function removeScheduleMarker(content, entities, match) {
	const markerStart = match.index;
	const markerEnd = markerStart + match[0].length;
	const withoutMarker = content.slice(0, markerStart) + content.slice(markerEnd);
	const leadingWhitespace = withoutMarker.length - withoutMarker.trimStart().length;
	const trimmedEnd = withoutMarker.trimEnd().length;

	const adjustedEntities = (entities || [])
		.map((entity) => {
			const entityEnd = entity.offset + entity.length;
			if (entity.offset < markerEnd && entityEnd > markerStart) return null;

			const offset =
				entity.offset >= markerEnd
					? entity.offset - match[0].length
					: entity.offset;
			if (offset < leadingWhitespace || offset + entity.length > trimmedEnd) {
				return null;
			}
			return { ...entity, offset: offset - leadingWhitespace };
		})
		.filter(Boolean);

	return {
		content: withoutMarker.trim(),
		entities: adjustedEntities,
	};
}

async function scheduleMessage(message, match, bot) {
	const [_, day, month, year, hour, minute] = match;
	const isText = typeof message.text === 'string';
	const originalContent = message.caption || message.text || '';
	const originalEntities = message.caption_entities || message.entities || [];
	const processed = removeScheduleMarker(originalContent, originalEntities, match);

	// Создаем дату в Киевском часовом поясе
	const kievDate = moment.tz(
		`${year}-${month}-${day} ${hour}:${minute}`,
		'YYYY-MM-DD HH:mm',
		'Europe/Kiev'
	);

	// Проверяем, что дата в будущем (по Киеву)
	if (kievDate.isBefore(moment().tz('Europe/Kiev'))) {
		await sendReply(message, '❌ Указанная дата уже прошла');
		return;
	}

	// Сохраняем сообщение в базу данных (в UTC)
	const scheduledMessage = new ScheduledMessage({
		sendDate: kievDate.toDate(), // сохраняем как Date (UTC)
		messageData: {
			chatId: message.chat.id,
			messageId: message.message_id,
			content: processed.content,
			entities: processed.entities,
			isText,
			showCaptionAboveMedia: message.show_caption_above_media,
			hasMediaSpoiler: message.has_media_spoiler,
		},
	});

	await scheduledMessage.save();

	await sendReply(
		message,
		`⏳ Отправка сообщения в ${kievDate.format(
			'YYYY-MM-DD HH:mm (Europe/Kiev)'
		)}`
	);

	const job = schedule.scheduleJob(kievDate.toDate(), async () => {
		try {
			if (scheduledMessage.messageData.isText) {
				await sendTextMessage(
					scheduledMessage.messageData.content,
					scheduledMessage.messageData.entities
				);
			} else {
				await sendMessage(
					scheduledMessage.messageData.chatId,
					scheduledMessage.messageData.messageId,
					scheduledMessage.messageData.content,
					scheduledMessage.messageData.entities,
					scheduledMessage.messageData.showCaptionAboveMedia,
					scheduledMessage.messageData.hasMediaSpoiler
				);
			}

			await bot.telegram.deleteMessage(message.chat.id, message.message_id);
			await ScheduledMessage.deleteOne({ _id: scheduledMessage._id });
		} catch (error) {
			console.error(`Ошибка при отправке: ${error.message}`);
			scheduledMessage.status = 'failed';
			await scheduledMessage.save();
			await sendReply(message, `❌ Ошибка: ${error.message}`);
		}
	});

	if (!job) {
		console.error('Не удалось создать задание планировщика');
		await ScheduledMessage.deleteOne({ _id: scheduledMessage._id });
		await sendReply(message, '❌ Ошибка при создании задания');
		return;
	}

	scheduledMessage.jobId = job.name;
	await scheduledMessage.save();
}

// Восстановление заданий при запуске
async function restoreScheduledMessages(bot) {
	const now = moment().tz('Europe/Kiev').toDate(); // Текущее время по Киеву

	const messages = await ScheduledMessage.find({
		status: 'pending',
		sendDate: { $gt: now },
	});

	if (messages.length) {
		console.log('Восстановление заданий при запуске');
	}

	for (const msg of messages) {
		const job = schedule.scheduleJob(msg.sendDate, async () => {
			try {
				if (msg.mediaGroupId) {
					await sendMediaGroup(msg.messageData.media);
				} else if (msg.messageData.isText) {
					await sendTextMessage(
						msg.messageData.content,
						msg.messageData.entities
					);
				} else {
					await sendMessage(
						msg.messageData.chatId,
						msg.messageData.messageId,
						msg.messageData.content,
						msg.messageData.entities || msg.messageData.captionEntities,
						msg.messageData.showCaptionAboveMedia,
						msg.messageData.hasMediaSpoiler
					);
				}

				await ScheduledMessage.deleteOne({ _id: msg._id });
			} catch (error) {
				msg.status = 'failed';
				await msg.save();
			}
		});
		msg.jobId = job.name;
		await msg.save();
	}
}

module.exports = {
	scheduleMessage,
	restoreScheduledMessages,
	removeScheduleMarker,
};
