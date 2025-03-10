const mongoose = require('mongoose');

const adminLogSchema = new mongoose.Schema({
	messages: { type: [Number], default: [] }, // Массив ID сообщений
	updatedAt: { type: Date, default: Date.now }, // Время последнего обновления
});

const AdminLog = mongoose.model('AdminLog', adminLogSchema);

module.exports = AdminLog;
