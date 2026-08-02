const AdminLog = require('../models/AdminLogMessage');
const mongoose = require('mongoose');

const ADMIN_LOG_ID = new mongoose.Types.ObjectId('000000000000000000000001');

// Добавление сообщения в лог
async function addAdminLogMessage(messageId) {
	try {
		await AdminLog.updateOne(
			{ _id: ADMIN_LOG_ID },
			{ $push: { messages: messageId }, $set: { updatedAt: new Date() } },
			{ upsert: true }
		);
	} catch (error) {
		console.error('Error adding log message:', error);
	}
}

// Получение всех сообщений из лога
async function getAdminLogMessages() {
	try {
		const logs = await AdminLog.find({});
		return [...new Set(logs.flatMap((log) => log.messages || []))];
	} catch (error) {
		console.error('Error getting log messages:', error);
		return [];
	}
}

// Очистка лога
async function clearAdminLogMessages() {
	try {
		await AdminLog.updateMany(
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
