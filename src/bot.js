const { Telegraf } = require('telegraf');
const schedule = require('node-schedule');

const { startServer } = require('./server/server');

const { restoreScheduledMessages } = require('./utils/scheduler');
const { scheduleMessage } = require('./utils/scheduler');
const { setupCleanup } = require('./utils/cleanup');
const { getFileId } = require('./utils/getFileId');

const setupMessageHandlers = require('./handlers/messageHandler');
const setupDeleteHandlers = require('./handlers/deleteHandlers');
const setupEditedMessageHandler = require('./handlers/editedMessageHandler');

const QueueManager = require('./managers/queueManager');
const {
	sendPauseKeyboard,
	registerPauseHandlers,
} = require('./managers/pauseManager');

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

// Отслеживание сообщений
setupMessageHandlers(bot, queueManager);

// Отслеживание удалений
setupDeleteHandlers(bot, queueManager);

// Отслеживание редактирования сообщений
setupEditedMessageHandler(bot, queueManager);

restoreScheduledMessages(bot);

bot.telegram.sendMessage(ADMIN_ID, '🤖 Бот запущен!');
bot.launch().then(async () => {
	await sendPauseKeyboard(bot, ADMIN_ID);
});
