const { Telegraf } = require('telegraf');
const { Markup } = require('telegraf');
const schedule = require('node-schedule');
const punycode = require('punycode/');
const moment = require('moment');
const { startServer } = require('./server');
const { scheduleMessage } = require('./scheduler');

const {
	BOT_TOKEN,
	CHANNEL_ID,
	ADMIN_ID,
	SEND_TIMER,
	SEND_COOLDOWN,
	TIME_ZONE,
} = require('./config');

const bot = new Telegraf(BOT_TOKEN);
let queue = [];
let mediaGroups = new Map();
let isPaused = false;
let keyboardMessageId = null;

// Импортируем функции отправки
const {
	sendMessage,
	sendMediaGroup,
	sendReply,
	sendReplyWithDeleteButton,
	getAdminLogMessages,
	clearAdminLogMessages,
} = require('./Sends');
// Функция для отправки обычного сообщения

schedule.scheduleJob('0 3 * * *', async () => {
	console.log('[CLEAN] Запущено удаление лог-сообщений администратора');

	// Получаем сохранённые идентификаторы сообщений
	const adminLogMessages = getAdminLogMessages();

	console.log('[CLEAN] adminLogMessages', adminLogMessages);

	// Проходим по списку сохранённых идентификаторов
	for (const msgId of adminLogMessages) {
		try {
			await bot.telegram.deleteMessage(ADMIN_ID, msgId);
			console.log(`[CLEAN] Удалено сообщение с id ${msgId}`);
		} catch (error) {
			console.error(
				`[ERROR] Ошибка при удалении сообщения ${msgId}: ${error.message}`
			);
		}
	}

	// Очищаем лог-сообщения после удаления
	clearAdminLogMessages();
});

// Функция для получения fileId для медиафайлов
function getFileId(message) {
	const mediaType = ['photo', 'video', 'document', 'audio'].find(
		(type) => message[type]
	);

	if (!mediaType) return null;
	const mediaContent = message[mediaType];

	if (Array.isArray(mediaContent)) {
		return mediaContent[mediaContent.length - 1].file_id;
	} else {
		return mediaContent.file_id;
	}
}

function isMediaGroupDuplicate(newMedia) {
	// Собираем fileId из новой медиагруппы и сортируем для корректного сравнения
	const newFileIds = newMedia.map((item) => item.media).sort();
	return queue.some((task) => {
		// Если задание не является медиагруппой или количество файлов отличается, пропускаем
		if (!task.media || task.media.length !== newMedia.length) return false;
		const taskFileIds = task.media.map((item) => item.media).sort();
		// Сравниваем каждый fileId
		return newFileIds.every((id, index) => id === taskFileIds[index]);
	});
}

function getPauseKeyboard() {
	return isPaused
		? Markup.keyboard([['▶️ Возобновить']])
				.resize()
				.oneTime()
		: Markup.keyboard([['⏸️ Пауза']])
				.resize()
				.oneTime();
}

// Функция для обработки медиагруппы
function processMediaGroup(message, mediaGroupId, mediaArray) {
	const mediaType = ['photo', 'video', 'document', 'audio'].find(
		(type) => message[type]
	);

	const fileId = getFileId(message);
	if (fileId) {
		mediaArray.push({
			type: mediaType,
			media: fileId,
			messageId: message.message_id, // Сохраняем messageId
			has_media_spoiler: message.has_media_spoiler || false,
			// Telegram разрешает подпись только у первого элемента
			caption:
				mediaArray.length === 0
					? message.caption || message.text || ''
					: undefined,
			caption_entities:
				mediaArray.length === 0
					? message.caption_entities || undefined
					: undefined,
			show_caption_above_media:
				mediaArray.length === 0
					? message.show_caption_above_media || false
					: undefined,
		});

		// Даем время на поступление остальных сообщений из группы
		setTimeout(async () => {
			const groupMedia = mediaGroups.get(mediaGroupId);
			if (groupMedia && groupMedia.length > 0) {
				if (isMediaGroupDuplicate(groupMedia)) {
					// Удаляем ВСЕ сообщения медиагруппы из чата администратора
					for (const mediaItem of groupMedia) {
						try {
							await bot.telegram.deleteMessage(
								message.chat.id, // message.chat.id - это чат администратора
								mediaItem.messageId
							);
							console.log(`[DELETE] Удален дубликат: ${mediaItem.messageId}`);
						} catch (error) {
							// Не знаешь => не трогай
						}
					}

					await sendReply(
						message,
						'❌ Медиагруппа уже в очереди. Сообщения удалены.'
					);
					mediaGroups.delete(mediaGroupId);
					return;
				}
				// Добавляем медиагруппу в очередь
				queue.push({
					chatId: message.chat.id,
					media: groupMedia,
					mediaGroupId: mediaGroupId,
				});
				mediaGroups.delete(mediaGroupId);
				const inlineKeyboard = Markup.inlineKeyboard([
					Markup.button.callback(
						'Удалить медиагруппу из очереди',
						`delete_from_queue_media_${mediaGroupId}`
					),
				]);

				await sendReply(
					message,
					'✅ Медиафайлы добавлены в очередь.',
					inlineKeyboard
				);
			}
		}, 2000);
	} else {
		sendReply(message, '❌ Ошибка: Не удалось определить `file_id`.');
	}
}

// Основная функция для обработки сообщений из очереди
async function sendMessageFromQueue() {
	if (isPaused) {
		console.log('[PAUSE] Рассылка приостановлена');
		return;
	}

	if (queue.length === 0) {
		console.log('[QUEUE] Очередь пуста, ничего не отправляем.');
		return;
	}

	const task = queue.shift();
	console.log(
		`[QUEUE] Отправляем сообщение из очереди: ${JSON.stringify(task)}`
	);

	try {
		if (task.media.length > 1) {
			console.log(
				`[QUEUE] Обнаружена медиагруппа (${task.media.length} файлов), отправляем...`
			);
			// Удаляем подписи у всех элементов кроме первого
			task.media.forEach((item, index) => {
				if (index > 0) {
					delete item.caption;
					delete item.caption_entities;
					delete item.show_caption_above_media;
				}
			});

			await sendMediaGroup(task.media);
			console.log('[QUEUE] Медиагруппа успешно отправлена!');

			// Удаление исходных сообщений из чата
			for (const mediaItem of task.media) {
				if (mediaItem.messageId) {
					try {
						await bot.telegram.deleteMessage(task.chatId, mediaItem.messageId);
						console.log(
							`[DELETE] Удалено сообщение медиагруппы: ${mediaItem.messageId}`
						);
					} catch (error) {
						console.error(
							`[ERROR] Ошибка при удалении ${mediaItem.messageId}: ${error.message}`
						);
					}
				} else {
					console.error(
						`[ERROR] Нет messageId для удаления: ${JSON.stringify(mediaItem)}`
					);
				}
			}
		} else {
			console.log(
				`[QUEUE] Отправляем одиночное сообщение: ${task.media[0].messageId}`
			);

			//
			await sendMessage(
				task.chatId,
				task.media[0].messageId,
				task.media[0].caption || '',
				task.media[0].caption_entities || undefined,
				task.media[0].show_caption_above_media || undefined,
				task.media[0].has_media_spoiler || undefined
			);
			console.log(
				`[QUEUE] Сообщение ${task.media[0].messageId} успешно отправлено!`
			);
			try {
				await bot.telegram.deleteMessage(task.chatId, task.media[0].messageId);
				console.log(
					`[DELETE] Одиночное сообщение удалено: ${task.media[0].messageId}`
				);
			} catch (error) {
				console.error(
					`[ERROR] Ошибка при удалении ${task.media[0].messageId}: ${error.message}`
				);
			}
		}

		sendReply(
			ADMIN_ID,
			`✅ Сообщение переслано и удалено! В очереди ${queue.length}`
		);
	} catch (error) {
		console.error(`[ERROR] Ошибка при отправке сообщения: ${error.message}`);
		sendReply(ADMIN_ID, `❌ Ошибка: ${error.message}`);
	}
}

async function sendPauseKeyboard(ctx) {
	const keyboard = getPauseKeyboard();
	const messageText = '❤️'; // Пустой пробел вместо текста

	try {
		if (keyboardMessageId) {
			await bot.telegram.editMessageText(
				ADMIN_ID,
				keyboardMessageId,
				null,
				messageText,
				{ reply_markup: keyboard.reply_markup }
			);
		} else {
			const sentMessage = await bot.telegram.sendMessage(
				ADMIN_ID,
				messageText,
				keyboard
			);
			keyboardMessageId = sentMessage.message_id;
		}
	} catch (error) {
		if (error.description.includes('message to edit not found')) {
			const sentMessage = await bot.telegram.sendMessage(
				ADMIN_ID,
				messageText,
				keyboard
			);
			keyboardMessageId = sentMessage.message_id;
		} else {
			console.error('Ошибка клавиатуры:', error);
		}
	}
}

schedule.scheduleJob(SEND_TIMER, sendMessageFromQueue);

bot.on('message', async (ctx) => {
	if (ctx.chat.id !== ADMIN_ID) return;

	// Фильтруем сообщения-команды, чтобы они не попадали в очередь
	const text = ctx.message.text;
	if (text === '⏸️ Пауза' || text === '▶️ Возобновить') {
		isPaused = !isPaused;

		// Обновляем основную клавиатуру
		await sendPauseKeyboard(ctx);
		await ctx.deleteMessage(); // Удаляем сообщение с кнопкой
		return;
	}

	setTimeout(() => {
		const { message } = ctx;
		const mediaGroupId = message.media_group_id;
		const caption = message.caption || message.text || '';
		const newMessageFileId = getFileId(message);

		// Проверяем, есть ли в очереди сообщение с таким же id, текстом или изображением
		const isMessageInQueue = queue.some((task) => {
			const taskMedia = task.media[0];
			const taskMessageContent = taskMedia.caption || '';
			const taskFileId = taskMedia.fileId || null;
			return (
				taskMedia.messageId === message.message_id ||
				(caption != '#вагонетка_дня' &&
					taskMessageContent === caption &&
					newMessageFileId &&
					taskFileId === newMessageFileId) ||
				(newMessageFileId && taskFileId === newMessageFileId)
			);
		});

		if (isMessageInQueue) {
			sendReply(message, '❌ Такое сообщение уже присутствует в очереди')
				.then(() =>
					bot.telegram.deleteMessage(message.chat.id, message.message_id)
				)
				.then(() => {
					return;
				});
			return;
		}

		// Ищем дату в формате "день-месяц-год час:минута"
		const dateRegex = /(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2})/;
		const match = caption.match(dateRegex);

		if (match) {
			scheduleMessage(message, match, mediaGroupId, bot);
			return;
		} else if (mediaGroupId) {
			// Обработка медиагруппы
			if (!mediaGroups.has(mediaGroupId)) {
				mediaGroups.set(mediaGroupId, []);
			}
			const mediaArray = mediaGroups.get(mediaGroupId);
			processMediaGroup(message, mediaGroupId, mediaArray);
			return;
		} else {
			// Если даты нет, просто добавляем в очередь
			queue.push({
				chatId: message.chat.id,
				media: [
					{
						type: 'message',
						messageId: message.message_id,
						caption: message.caption,
						caption_entities: message.caption_entities,
						show_caption_above_media: message.show_caption_above_media,
						has_media_spoiler: message.has_media_spoiler,
						fileId: newMessageFileId,
					},
				],
			});
			sendReplyWithDeleteButton(message, '✅ Сообщение добавлено в очередь.');
		}
	}, SEND_COOLDOWN);

	if (!keyboardMessageId) {
		await sendPauseKeyboard(ctx);
	}
});

bot.on('edited_message', async (ctx) => {
	if (ctx.chat.id !== ADMIN_ID) return;
	const editedMessage = ctx.update.edited_message;

	if (!editedMessage?.chat || editedMessage.chat.id !== ADMIN_ID) {
		console.error('[ERROR] editedMessage или chat не определены');
		return;
	}

	const messageId = editedMessage.message_id;

	// Ищем элемент очереди по message_id
	const taskIndex = queue.findIndex(
		(task) => task.media[0].messageId === messageId
	);

	if (taskIndex !== -1) {
		queue[taskIndex].media[0].caption =
			editedMessage.caption || editedMessage.text || '';

		queue[taskIndex].media[0].fileId = getFileId(editedMessage);

		queue[taskIndex].media[0].caption_entities =
			editedMessage.caption_entities || '';

		queue[taskIndex].media[0].show_caption_above_media =
			editedMessage.show_caption_above_media || '';

		queue[taskIndex].media[0].has_media_spoiler =
			editedMessage.has_media_spoiler || '';

		sendReply(ADMIN_ID, 'Сообщение обновлено в очереди.');
		console.log(`[EDITED]Сообщение ${messageId} обновлено в очереди.`);
	} else {
		console.log(
			`[ERROR] Редактированное сообщение ${messageId} не найдено в очереди.`
		);
	}
});

bot.action(/delete_from_queue_(\d+)/, async (ctx) => {
	const messageIdToDelete = Number(ctx.match[1]);

	// Ищем задание по message_id в очереди
	const taskIndex = queue.findIndex(
		(task) => task.media[0].messageId === messageIdToDelete
	);

	if (taskIndex !== -1) {
		// Удаляем задание из очереди
		queue.splice(taskIndex, 1);

		// Опционально: удаляем уведомление из чата администратора
		try {
			await bot.telegram.deleteMessage(ctx.chat.id, messageIdToDelete);
			console.log(`Сообщение ${messageIdToDelete} удалено из очереди.`);
		} catch (error) {
			console.error(
				`Ошибка при удалении сообщения ${messageIdToDelete}: ${error.message}`
			);
		}

		// Подтверждаем действие администратору
		await ctx.answerCbQuery('Сообщение удалено из очереди.');
	} else {
		await ctx.answerCbQuery('Сообщение не найдено в очереди.');
	}
});

bot.action(/delete_from_queue_media_(.+)/, async (ctx) => {
	const mediaGroupId = ctx.match[1];
	// Ищем задачу в очереди по mediaGroupId
	const taskIndex = queue.findIndex(
		(task) => task.mediaGroupId === mediaGroupId
	);

	if (taskIndex !== -1) {
		const task = queue[taskIndex];
		// Удаляем задачу из очереди
		queue.splice(taskIndex, 1);

		// Удаляем все исходные сообщения медиагруппы из чата администратора
		for (const mediaItem of task.media) {
			if (mediaItem.messageId) {
				try {
					await bot.telegram.deleteMessage(task.chatId, mediaItem.messageId);
					console.log(
						`[DELETE] Удалено сообщение медиагруппы: ${mediaItem.messageId}`
					);
				} catch (error) {
					console.error(
						`[ERROR] Ошибка при удалении ${mediaItem.messageId}: ${error.message}`
					);
				}
			}
		}

		await ctx.answerCbQuery('Медиагруппа удалена из очереди.');
	} else {
		await ctx.answerCbQuery('Медиагруппа не найдена в очереди.');
	}
});

bot.action('toggle_pause', async (ctx) => {
	isPaused = !isPaused;
	const keyboard = Markup.inlineKeyboard([
		Markup.button.callback(
			isPaused ? '▶️ Возобновить' : '⏸️ Пауза',
			'toggle_pause'
		),
	]);

	try {
		await ctx.editMessageReplyMarkup(keyboard.reply_markup);
		await ctx.answerCbQuery(
			isPaused ? '⏸️ Рассылка приостановлена' : '▶️ Рассылка возобновлена'
		);
	} catch (error) {
		console.error('Ошибка при обновлении кнопки:', error);
	}
});

startServer();

bot.telegram.sendMessage(ADMIN_ID, '🤖 Бот запущен!');
bot.launch().then(async () => {
	// Отправляем начальное сообщение с текстом
	const initialMessage = await bot.telegram.sendMessage(
		ADMIN_ID,
		'🤖 Управление рассылкой:',
		getPauseKeyboard()
	);

	// Удаляем текст через 2 секунды
	setTimeout(async () => {
		try {
			await bot.telegram.editMessageText(
				ADMIN_ID,
				initialMessage.message_id,
				null,
				' ', // Заменяем на пробел
				{ reply_markup: getPauseKeyboard().reply_markup }
			);
			keyboardMessageId = initialMessage.message_id;
		} catch (error) {
			console.error('Ошибка редактирования:', error);
		}
	}, 2000);
});
