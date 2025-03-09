const { Telegraf, Markup } = require('telegraf');
const schedule = require('node-schedule');
const { startServer } = require('./server/server');
const { scheduleMessage } = require('./utils/scheduler');
const { setupCleanup } = require('./utils/cleanup');
const { getFileId } = require('./utils/getFileId');
const {
	getPauseKeyboard,
	sendPauseKeyboard,
	registerPauseHandlers,
	togglePause,
	getIsPaused,
	keyboardMessageId,
} = require('./managers/pauseManager');

const { BOT_TOKEN, ADMIN_ID, SEND_TIMER, SEND_COOLDOWN } = require('./config');

const {
	sendMessage,
	sendMediaGroup,
	sendReply,
	sendReplyWithDeleteButton,
	getAdminLogMessages,
	clearAdminLogMessages,
} = require('./services/Sends');

const bot = new Telegraf(BOT_TOKEN);
let queue = [];
let mediaGroups = new Map();

// Инициализация очистки
setupCleanup(
	schedule,
	bot,
	ADMIN_ID,
	getAdminLogMessages,
	clearAdminLogMessages
);

// Регистрация обработчиков паузы
registerPauseHandlers(bot);

function isMediaGroupDuplicate(newMedia) {
	const newFileIds = newMedia.map((item) => item.media).sort();
	return queue.some((task) => {
		if (!task.media || task.media.length !== newMedia.length) return false;
		const taskFileIds = task.media.map((item) => item.media).sort();
		return newFileIds.every((id, index) => id === taskFileIds[index]);
	});
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
			messageId: message.message_id,
			has_media_spoiler: message.has_media_spoiler || false,
			caption:
				mediaArray.length === 0
					? message.caption || message.text || ''
					: undefined,
			caption_entities:
				mediaArray.length === 0 ? message.caption_entities : undefined,
			show_caption_above_media:
				mediaArray.length === 0 ? message.show_caption_above_media : false,
		});

		setTimeout(async () => {
			const groupMedia = mediaGroups.get(mediaGroupId);
			if (groupMedia?.length > 0) {
				if (isMediaGroupDuplicate(groupMedia)) {
					for (const mediaItem of groupMedia) {
						try {
							await bot.telegram.deleteMessage(
								message.chat.id,
								mediaItem.messageId
							);
						} catch (error) {}
					}
					await sendReply(
						message,
						'❌ Медиагруппа уже в очереди. Сообщения удалены.'
					);
					mediaGroups.delete(mediaGroupId);
					return;
				}
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

async function sendMessageFromQueue() {
	if (getIsPaused()) {
		console.log('[PAUSE] Рассылка приостановлена');
		return;
	}

	if (queue.length === 0) return;

	const task = queue.shift();
	try {
		if (task.media.length > 1) {
			task.media.forEach((item, index) => {
				if (index > 0) {
					delete item.caption;
					delete item.caption_entities;
					delete item.show_caption_above_media;
				}
			});
			await sendMediaGroup(task.media);
			for (const mediaItem of task.media) {
				try {
					await bot.telegram.deleteMessage(task.chatId, mediaItem.messageId);
				} catch (error) {
					console.error(`[ERROR] Удаление: ${error.message}`);
				}
			}
		} else {
			await sendMessage(
				task.chatId,
				task.media[0].messageId,
				task.media[0].caption || '',
				task.media[0].caption_entities,
				task.media[0].show_caption_above_media,
				task.media[0].has_media_spoiler
			);
			try {
				await bot.telegram.deleteMessage(task.chatId, task.media[0].messageId);
			} catch (error) {
				console.error(`[ERROR] Удаление: ${error.message}`);
			}
		}
		sendReply(ADMIN_ID, `✅ Сообщение переслано! В очереди ${queue.length}`);
	} catch (error) {
		console.error(`[ERROR] Отправка: ${error.message}`);
		sendReply(ADMIN_ID, `❌ Ошибка: ${error.message}`);
	}
}

schedule.scheduleJob(SEND_TIMER, sendMessageFromQueue);

bot.on('message', async (ctx) => {
	if (ctx.chat.id !== ADMIN_ID) return;

	const text = ctx.message.text;
	if (text === '⏸️ Пауза' || text === '▶️ Возобновить') {
		togglePause();
		await sendPauseKeyboard(bot, ADMIN_ID);
		await ctx.deleteMessage();
		return;
	}

	setTimeout(() => {
		const { message } = ctx;
		const mediaGroupId = message.media_group_id;
		const caption = message.caption || message.text || '';
		const newMessageFileId = getFileId(message);

		const isMessageInQueue = queue.some(
			(task) =>
				task.media[0].messageId === message.message_id ||
				(caption !== '#вагонетка_дня' &&
					task.media[0].caption === caption &&
					newMessageFileId === task.media[0].fileId)
		);

		if (isMessageInQueue) {
			sendReply(message, '❌ Сообщение уже в очереди').then(() =>
				bot.telegram.deleteMessage(message.chat.id, message.message_id)
			);
			return;
		}

		const dateRegex = /(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2})/;
		const match = caption.match(dateRegex);

		if (match) {
			scheduleMessage(message, match, mediaGroupId, bot);
		} else if (mediaGroupId) {
			if (!mediaGroups.has(mediaGroupId)) mediaGroups.set(mediaGroupId, []);
			processMediaGroup(message, mediaGroupId, mediaGroups.get(mediaGroupId));
		} else {
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

	if (!keyboardMessageId) await sendPauseKeyboard(bot, ADMIN_ID);
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

startServer();

bot.telegram.sendMessage(ADMIN_ID, '🤖 Бот запущен!');
bot.launch().then(async () => {
	const initialMessage = await bot.telegram.sendMessage(
		ADMIN_ID,
		'❤️',
		getPauseKeyboard() // Используем функцию из модуля
	);
	keyboardMessageId = initialMessage.message_id; // Используем сеттер

	await sendPauseKeyboard(bot, ADMIN_ID);

	setTimeout(async () => {
		try {
			await bot.telegram.editMessageText(
				ADMIN_ID,
				initialMessage.message_id,
				null,
				' ',
				{ reply_markup: getPauseKeyboard().reply_markup }
			);
		} catch (error) {
			console.error('Ошибка редактирования:', error);
		}
	}, 2000);
});
