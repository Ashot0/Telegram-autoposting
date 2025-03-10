const AdminLog = require('../models/AdminLog');

// Добавление сообщения в лог
async function addAdminLogMessage(messageId) {
	try {
		await AdminLog.updateOne(
			{}, // Ищем первый документ (у нас будет только один)
			{ $push: { messages: messageId }, $set: { updatedAt: new Date() } },
			{ upsert: true } // Создаем документ, если он не существует
		);
	} catch (error) {
		console.error('Error adding log message:', error);
	}
}

// Получение всех сообщений из лога
async function getAdminLogMessages() {
	try {
		const log = await AdminLog.findOne({});
		return log ? log.messages : [];
	} catch (error) {
		console.error('Error getting log messages:', error);
		return [];
	}
}

// Очистка лога
async function clearAdminLogMessages() {
	try {
		await AdminLog.updateOne(
			{},
			{ $set: { messages: [], updatedAt: new Date() } }
		);
	} catch (error) {
		console.error('Error clearing log messages:', error);
	}
}

module.exports = {
	addAdminLogMessage,
	getAdminLogMessages,
	clearAdminLogMessages,
};
