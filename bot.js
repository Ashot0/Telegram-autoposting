const { Telegraf } = require('telegraf');
const schedule = require('node-schedule');
const { BOT_TOKEN, CHANNEL_ID, ADMIN_ID } = require('./config');
const { startServer } = require('./server');
const moment = require('moment'); // Для удобной работы с датами

const bot = new Telegraf(BOT_TOKEN);
let queue = [];
let mediaGroups = new Map();

// Функция для отправки обычного сообщения
async function sendMessage(chatId, messageId, caption) {
	try {
		await bot.telegram.copyMessage(CHANNEL_ID, chatId, messageId, { caption });
	} catch (error) {
		throw new Error(`Ошибка при отправке сообщения: ${error.message}`);
	}
}

// Функция для отправки медиагруппы
async function sendMediaGroup(media) {
	try {
		await bot.telegram.sendMediaGroup(CHANNEL_ID, media);
	} catch (error) {
		throw new Error(`Ошибка при отправке медиагруппы: ${error.message}`);
	}
}

// Функция для отправки ответа пользователю
async function sendReply(message, text) {
	try {
		await bot.telegram.sendMessage(message.chat.id, text);
	} catch (error) {
		console.error('Ошибка при отправке ответа:', error.message);
	}
}

// Функция для получения fileId для медиафайлов
function getFileId(message) {
	const mediaType = ['photo', 'video', 'document', 'audio'].find(
		(type) => message[type]
	);
	return mediaType
		? message[mediaType].file_id ||
				message[mediaType][message[mediaType].length - 1].file_id
		: null;
}

// Функция для обработки медиагруппы
function processMediaGroup(message, mediaGroupId, mediaArray) {
	const mediaType = ['photo', 'video', 'document', 'audio'].find(
		(type) => message[type]
	); // Определяем тип медиа
	const fileId = getFileId(message); // Получаем file_id
	if (fileId) {
		mediaArray.push({
			type: mediaType, // Указываем тип медиа
			media: fileId,
			has_media_spoiler: message.has_media_spoiler || false,
			caption:
				mediaArray.length === 0
					? message.caption || message.text || ''
					: undefined,
			caption_entities:
				mediaArray.length === 0 ? message.caption_entities || '' : undefined,
			show_caption_above_media:
				mediaArray.length === 0
					? message.show_caption_above_media || false
					: undefined,
		});

		setTimeout(() => {
			if (
				mediaGroups.has(mediaGroupId) &&
				mediaGroups.get(mediaGroupId).length > 0
			) {
				queue.push({
					chatId: message.chat.id,
					media: mediaGroups.get(mediaGroupId),
				});
				mediaGroups.delete(mediaGroupId);
				sendReply(message, '✅ Медиафайлы добавлены в очередь.');
			}
		}, 2000);
	} else {
		sendReply(message, '❌ Ошибка: Не удалось определить `file_id`.');
	}
}

// Основная функция для обработки сообщений из очереди
async function sendMessageFromQueue() {
	if (queue.length === 0) return;
	const task = queue.shift();

	try {
		if (task.media.length > 1) {
			task.media.forEach((item, index) => {
				if (index > 0) delete item.caption;
			});
			await sendMediaGroup(task.media); // Отправляем медиагруппу
		} else {
			await sendMessage(
				task.chatId,
				task.media[0].messageId,
				task.media[0].caption || ''
			); // Отправляем обычное сообщение
		}
		await bot.telegram.sendMessage(ADMIN_ID, '✅ Сообщение переслано!');
	} catch (error) {
		await bot.telegram.sendMessage(ADMIN_ID, `❌ Ошибка: ${error.message}`);
	}
}

schedule.scheduleJob('0 * * * *', sendMessageFromQueue);

bot.on('message', async (ctx) => {
	if (ctx.chat.id !== ADMIN_ID) return;

	setTimeout(() => {
		const { message } = ctx;
		const mediaGroupId = message.media_group_id;
		const caption = message.caption || message.text || '';

		// Регулярное выражение для поиска даты в формате "день-месяц-год час:минута"
		const dateRegex = /(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2})/;
		const match = caption.match(dateRegex);

		if (match) {
			// Извлекаем дату и время
			const [_, day, month, year, hour, minute] = match;
			const sendDate = moment(
				`${year}-${month}-${day} ${hour}:${minute}`,
				'YYYY-MM-DD HH:mm'
			);

			// Убираем дату из текста сообщения
			const newCaption = caption.replace(dateRegex, '').trim();

			// Устанавливаем задачу для отправки сообщения
			const delay = sendDate.diff(moment(), 'milliseconds');
			if (delay > 0) {
				schedule.scheduleJob(sendDate.toDate(), async () => {
					queue.push({
						chatId: ctx.chat.id,
						media: [
							{
								type: 'message',
								messageId: message.message_id,
								caption: newCaption,
							},
						],
					});
					sendReply(ctx, '✅ Сообщение с датой отправлено в указанное время.');
				});
			} else {
				sendReply(ctx, '❌ Указанная дата уже прошла.');
			}
		} else if (mediaGroupId) {
			// Обработка медиагруппы
			if (!mediaGroups.has(mediaGroupId)) mediaGroups.set(mediaGroupId, []);

			const mediaArray = mediaGroups.get(mediaGroupId);
			processMediaGroup(message, mediaGroupId, mediaArray); // Обрабатываем медиагруппу
		} else {
			// Если даты нет, просто добавляем в очередь
			queue.push({
				chatId: ctx.chat.id,
				media: [{ type: 'message', messageId: message.message_id }],
			});
			sendReply(ctx, '✅ Сообщение добавлено в очередь.');
		}
	}, 600000);
});

startServer();
bot.launch();
bot.telegram.sendMessage(ADMIN_ID, '🤖 Бот запущен!');
