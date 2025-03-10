const mongoose = require('mongoose');
const { MONGODB_LOG_COLLECTION } = require('../config');

const adminLogSchema = new mongoose.Schema({
	messages: { type: [Number], default: [] }, // Массив ID сообщений
	updatedAt: { type: Date, default: Date.now }, // Время последнего обновления
});

const AdminLog = mongoose.model(
	'AdminLog',
	adminLogSchema,
	MONGODB_LOG_COLLECTION
);

module.exports = AdminLog;
