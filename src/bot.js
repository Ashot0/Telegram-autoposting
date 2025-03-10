const { Telegraf, Markup } = require('telegraf');
const schedule = require('node-schedule');
const { startServer } = require('./server/server');
const { scheduleMessage } = require('./utils/scheduler');
const { setupCleanup } = require('./utils/cleanup');
const { getFileId } = require('./utils/getFileId');
const QueueTask = require('./models/QueueTask');
const QueueManager = require('./managers/queueManager');
const {
	getPauseKeyboard,
	sendPauseKeyboard,
	registerPauseHandlers,
	togglePause,
	keyboardMessageId,
} = require('./managers/pauseManager');
const {
	sendMessage,
	sendMediaGroup,
	sendReply,
	sendReplyWithDeleteButton,
	getAdminLogMessages,
	clearAdminLogMessages,
} = require('./services/Sends');

const { BOT_TOKEN, ADMIN_ID, SEND_TIMER, SEND_COOLDOWN } = require('./config');

const bot = new Telegraf(BOT_TOKEN);
const queueManager = new QueueManager();

// Инициализация очистки
setupCleanup(schedule, bot, ADMIN_ID);

// Регистрация обработчиков паузы
registerPauseHandlers(bot);

schedule.scheduleJob(SEND_TIMER, async () => {
	await queueManager.sendMessageFromQueue(
		bot,
		ADMIN_ID,
		sendMediaGroup,
		sendMessage
	);
});

bot.on('message', async (ctx) => {
	if (ctx.chat.id !== ADMIN_ID) return;

	const text = ctx.message.text;
	if (text === '⏸️ Пауза' || text === '▶️ Возобновить') {
		togglePause();
		await sendPauseKeyboard(bot, ADMIN_ID);
		await ctx.deleteMessage();
		return;
	}

	setTimeout(async () => {
		const { message } = ctx;
		const mediaGroupId = message.media_group_id;
		const caption = message.caption || message.text || '';
		const newMessageFileId = getFileId(message);

		if (newMessageFileId) {
			const isDuplicate = await queueManager.isMediaDuplicate(
				newMessageFileId,
				message.chat.id
			);
			if (isDuplicate) {
				await sendReply(message, '❌ Этот файл уже в очереди.');
				await bot.telegram.deleteMessage(ADMIN_ID, ctx.message.message_id);
				return;
			}
		}

		// Проверка на дубликат для текстовых сообщений
		const queue = await queueManager.getQueue();
		const isMessageInQueue = queue.some(
			(task) =>
				task.media[0].messageId === message.message_id ||
				(caption !== '#вагонетка_дня' &&
					task.media[0].caption === caption &&
					newMessageFileId === task.media[0].fileId)
		);

		if (isMessageInQueue) {
			await sendReply(message, '❌ Сообщение уже в очереди.');
			await bot.telegram.deleteMessage(message.chat.id, message.message_id);
			return;
		}

		const dateRegex = /(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2})/;
		const match = caption.match(dateRegex);

		if (match) {
			scheduleMessage(message, match, mediaGroupId, bot);
		} else if (mediaGroupId) {
			if (!queueManager.mediaGroups.has(mediaGroupId)) {
				queueManager.mediaGroups.set(mediaGroupId, []);
			}

			// Добавляем сообщение в группу
			queueManager.mediaGroups.get(mediaGroupId).push({
				type: ['photo', 'video', 'document', 'audio'].find(
					(type) => message[type]
				),
				media: getFileId(message),
				messageId: message.message_id,
				caption: message.caption,
				caption_entities: message.caption_entities,
				show_caption_above_media: message.show_caption_above_media,
				has_media_spoiler: message.has_media_spoiler || false,
			});

			// Запускаем обработку только для первого сообщения в группе
			if (queueManager.mediaGroups.get(mediaGroupId).length === 1) {
				await queueManager.processMediaGroup(message, mediaGroupId);
			}
		} else if (newMessageFileId) {
			await queueManager.addToQueue({
				chatId: message.chat.id,
				media: [
					{
						type: ['photo', 'video', 'document', 'audio'].find(
							(type) => message[type]
						),
						media: newMessageFileId,
						messageId: message.message_id,
						caption: message.caption,
						caption_entities: message.caption_entities,
						show_caption_above_media: message.show_caption_above_media,
						has_media_spoiler: message.has_media_spoiler || false,
					},
				],
			});
			await sendReplyWithDeleteButton(
				message,
				'✅ Медиафайл добавлен в очередь.'
			);
		} else {
			await queueManager.addToQueue({
				chatId: message.chat.id,
				media: [
					{
						type: 'text',
						messageId: message.message_id,
						text: message.text,
						caption: message.caption,
						caption_entities: message.caption_entities,
						show_caption_above_media: message.show_caption_above_media,
					},
				],
			});
			await sendReplyWithDeleteButton(
				message,
				'✅ Сообщение добавлено в очередь.'
			);
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

	// Получаем очередь из базы данных
	const queue = await queueManager.getQueue();

	// Ищем задачу в очереди по messageId
	const taskIndex = queue.findIndex((task) =>
		task.media.some((media) => media.messageId === messageId)
	);

	if (taskIndex !== -1) {
		const task = queue[taskIndex];

		// Обновляем все элементы медиагруппы
		task.media.forEach((mediaItem) => {
			if (mediaItem.messageId === messageId) {
				mediaItem.caption = editedMessage.caption || editedMessage.text || '';
				mediaItem.fileId = getFileId(editedMessage);
				mediaItem.caption_entities = editedMessage.caption_entities || '';
				mediaItem.show_caption_above_media =
					editedMessage.show_caption_above_media || false;
				mediaItem.has_media_spoiler = editedMessage.has_media_spoiler || false;
			}
		});

		// Сохраняем обновлённую задачу в базе данных
		await queueManager.updateTask(task);

		// Уведомляем администратора
		await sendReply(ADMIN_ID, 'Сообщение обновлено в очереди.');
		console.log(`[EDITED] Сообщение ${messageId} обновлено в очереди.`);
	} else {
		console.log(
			`[ERROR] Редактированное сообщение ${messageId} не найдено в очереди.`
		);
	}
});

bot.action(/delete_from_queue_(\d+)/, async (ctx) => {
	const messageIdToDelete = Number(ctx.match[1]);

	await queueManager.removeFromQueue(messageIdToDelete);

	try {
		await ctx.deleteMessage();
		await bot.telegram.deleteMessage(ctx.chat.id, messageIdToDelete);
	} catch (error) {
		console.error('Ошибка при удалении:', error.message);
		await ctx.answerCbQuery('Не удалось удалить сообщение');
		return;
	}

	await ctx.answerCbQuery('Сообщение удалено из очереди');
});

bot.action(/delete_from_queue_media_(.+)/, async (ctx) => {
	const mediaGroupId = ctx.match[1];
	const task = await QueueTask.findOne({ mediaGroupId });

	if (!task) {
		await ctx.answerCbQuery('Медиагруппа не найдена');
		return;
	}

	await queueManager.removeMediaGroupFromQueue(mediaGroupId);

	try {
		for (const media of task.media) {
			await bot.telegram.deleteMessage(task.chatId, media.messageId);
		}
		await ctx.deleteMessage();
	} catch (error) {
		console.error('Ошибка удаления медиагруппы:', error);
		await ctx.answerCbQuery('Ошибка при удалении');
		return;
	}

	await ctx.answerCbQuery('Медиагруппа удалена');
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
