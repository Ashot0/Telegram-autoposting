const { Telegraf } = require('telegraf');
const schedule = require('node-schedule');

const { startServer } = require('./server/server');

const { scheduleMessage } = require('./utils/scheduler');
const { setupCleanup } = require('./utils/cleanup');
const { getFileId } = require('./utils/getFileId');

const setupDeleteHandlers = require('./handlers/deleteHandlers');
const setupEditedMessageHandler = require('./handlers/editedMessageHandler');

const {
	getPauseKeyboard,
	sendPauseKeyboard,
	registerPauseHandlers,
	togglePause,
	keyboardMessageId,
} = require('./managers/pauseManager');
const QueueManager = require('./managers/queueManager');

const {
	sendMessage,
	sendMediaGroup,
	sendReply,
	sendReplyWithDeleteButton,
} = require('./services/Sends');

const { BOT_TOKEN, ADMIN_ID, SEND_TIMER, SEND_COOLDOWN } = require('./config');

const bot = new Telegraf(BOT_TOKEN);
const queueManager = new QueueManager();

// Инициализация очистки
setupCleanup(schedule, bot, ADMIN_ID);

// Регистрация обработчиков паузы
registerPauseHandlers(bot);

// Инициализация отправки из очереди
schedule.scheduleJob(SEND_TIMER, async () => {
	await queueManager.sendMessageFromQueue(
		bot,
		ADMIN_ID,
		sendMediaGroup,
		sendMessage
	);
});

// Запуск сервера
startServer();

// Отслеживание удалений
setupDeleteHandlers(bot, queueManager);

// Отслеживание редактирования сообщений
setupEditedMessageHandler(bot, queueManager);

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

bot.telegram.sendMessage(ADMIN_ID, '🤖 Бот запущен!');
bot.launch().then(async () => {
	const initialMessage = await bot.telegram.sendMessage(
		ADMIN_ID,
		'❤️',
		getPauseKeyboard()
	);
	keyboardMessageId = initialMessage.message_id;

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
