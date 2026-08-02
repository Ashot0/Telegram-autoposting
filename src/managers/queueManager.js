const { Markup } = require('telegraf');
const { sendReply } = require('../services/Sends');
const { getIsPaused } = require('./pauseManager');
const QueueTask = require('../models/QueueTask');
const { connect } = require('../db');
const { ADMIN_ID } = require('../config');

class QueueManager {
	constructor() {
		this.mediaGroups = new Map();
		this.processingGroups = new Set();
		connect().catch(console.error);
	}

	async isMediaGroupDuplicate(newMedia) {
		const newFileIds = newMedia.map((item) => item.media).sort();
		const tasks = await QueueTask.find({ status: { $ne: 'sent' } });
		return tasks.some((task) => {
			if (!task.media || task.media.length !== newMedia.length) return false;
			const taskFileIds = task.media.map((item) => item.media).sort();
			return newFileIds.every((id, index) => id === taskFileIds[index]);
		});
	}

	async isMediaDuplicate(fileId, chatId) {
		return !!(await QueueTask.findOne({
			'media.media': fileId, // Ищем по file_id
			chatId: chatId, // Опционально, если проверка в рамках одного чата
			status: { $ne: 'sent' },
		}));
	}

	async processMediaGroup(message, mediaGroupId, mediaArray) {
		if (this.processingGroups.has(mediaGroupId)) {
			console.log(
				`[MEDIA GROUP] Медиагруппа ${mediaGroupId} уже обрабатывается.`
			);
			return;
		}
		this.processingGroups.add(mediaGroupId);

		try {
			console.log(`[MEDIA GROUP] Начало обработки медиагруппы ${mediaGroupId}`);

			// Ждём 3 секунды, чтобы собрать все сообщения группы
			await new Promise((resolve) => setTimeout(resolve, 3000));

			const groupMedia = this.mediaGroups.get(mediaGroupId);
			if (!groupMedia || groupMedia.length === 0) {
				console.log(`[MEDIA GROUP] Медиагруппа ${mediaGroupId} пуста.`);
				return;
			}
			groupMedia.sort((first, second) => first.messageId - second.messageId);

			console.log(
				`[MEDIA GROUP] Медиагруппа ${mediaGroupId} содержит ${groupMedia.length} файлов.`
			);

			// Проверка на дубликаты
			const exists = await QueueTask.findOne({
				mediaGroupId,
				status: { $ne: 'sent' },
			});
			if (exists) {
				console.log(`[MEDIA GROUP] Медиагруппа ${mediaGroupId} уже в очереди.`);
				await this.cleanupMediaGroup(message, groupMedia);
				return;
			}

			// Сохраняем медиагруппу в базу данных
			const task = new QueueTask({
				chatId: message.chat.id,
				media: groupMedia,
				mediaGroupId,
			});
			await task.save();
			console.log(
				`[MEDIA GROUP] Медиагруппа ${mediaGroupId} сохранена в базу данных.`
			);

			// Отправляем уведомление
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
			console.log(
				`[MEDIA GROUP] Медиагруппа ${mediaGroupId} успешно обработана.`
			);

			// Очищаем временные данные
			this.mediaGroups.delete(mediaGroupId);
		} catch (error) {
			console.error(
				`[ERROR] Ошибка при обработке медиагруппы ${mediaGroupId}: ${error.message}`
			);
			await sendReply(message, '❌ Ошибка при обработке медиагруппы.');
		} finally {
			this.processingGroups.delete(mediaGroupId);
		}
	}

	async sendMessageFromQueue(bot, ADMIN_ID, sendMediaGroup, sendMessage) {
		if (getIsPaused()) {
			console.log('[PAUSE] Рассылка приостановлена');
			return;
		}

		const staleProcessingDate = new Date(Date.now() - 15 * 60 * 1000);
		const task = await QueueTask.findOneAndUpdate(
			{
				$or: [
					{ status: 'pending' },
					{ status: { $exists: false } },
					{
						status: 'processing',
						processingStartedAt: { $lt: staleProcessingDate },
					},
				],
			},
			{
				$set: {
					status: 'processing',
					processingStartedAt: new Date(),
				},
			},
			{ sort: { createdAt: 1 }, new: true }
		);
		if (!task) return;
		const markTaskSent = () =>
			QueueTask.updateOne(
				{ _id: task._id, status: 'processing' },
				{
					$set: { status: 'sent' },
					$unset: { processingStartedAt: '' },
				}
			);

		try {
			if (task.media.length > 1) {
				const orderedMedia = [...task.media].sort(
					(first, second) => first.messageId - second.messageId
				);
				await sendMediaGroup(orderedMedia, task.chatId);
				await markTaskSent();
				for (const mediaItem of orderedMedia) {
					try {
						await bot.telegram.deleteMessage(task.chatId, mediaItem.messageId);
					} catch (error) {
						console.error(`[ERROR] Удаление: ${error.message}`);
					}
				}
			} else {
				await sendMessage(
					task.chatId,
					task.media[0].messageId
				);
				await markTaskSent();
				try {
					await bot.telegram.deleteMessage(
						task.chatId,
						task.media[0].messageId
					);
				} catch (error) {
					console.error(`[ERROR] Удаление: ${error.message}`);
				}
			}

			await QueueTask.deleteOne({ _id: task._id, status: 'sent' });
			sendReply(
				ADMIN_ID,
				`✅ Сообщение переслано! В очереди ${await QueueTask.countDocuments({ status: { $ne: 'sent' } })}`
			);
		} catch (error) {
			await QueueTask.updateOne(
				{ _id: task._id, status: 'processing' },
				{
					$set: { status: 'pending' },
					$unset: { processingStartedAt: '' },
				}
			);
			console.error(`[ERROR] Отправка: ${error.message}`);
			sendReply(ADMIN_ID, `❌ Ошибка: ${error.message}`);
		}
	}

	async addToQueue(task) {
		try {
			const newTask = new QueueTask(task);
			return await newTask.save();
		} catch (error) {
			console.error('Ошибка добавления в очередь:', error);
			throw error;
		}
	}

	async removeFromQueue(messageId) {
		await QueueTask.deleteOne({ 'media.messageId': messageId });
	}

	async removeMediaGroupFromQueue(mediaGroupId) {
		await QueueTask.deleteOne({ mediaGroupId });
	}

	async getQueue() {
		return await QueueTask.find({ status: { $ne: 'sent' } })
			.sort({ createdAt: 1 })
			.exec();
	}

	async updateTask(updatedTask) {
		try {
			await QueueTask.updateOne(
				{ _id: updatedTask._id },
				{ $set: { media: updatedTask.media } }
			);
			console.log(`[UPDATE] Задача ${updatedTask._id} обновлена.`);
		} catch (error) {
			console.error(`[ERROR] Ошибка обновления задачи: ${error.message}`);
			throw error;
		}
	}

	async cleanupMediaGroup(message, groupMedia) {
		console.log(`[CLEANUP] Удаление дубликата медиагруппы.`);

		for (const mediaItem of groupMedia) {
			try {
				await bot.telegram.deleteMessage(message.chat.id, mediaItem.messageId);
				console.log(
					`[DELETE] Удалено сообщение медиагруппы: ${mediaItem.messageId}`
				);
			} catch (error) {
				console.error(
					`[ERROR] Ошибка при удалении ${mediaItem.messageId}: ${error.message}`
				);
			}
		}

		await sendReply(
			message,
			'❌ Медиагруппа уже в очереди. Сообщения удалены.'
		);
		console.log(`[CLEANUP] Медиагруппа успешно удалена.`);
	}

	async removeMediaGroupFromQueue(mediaGroupId) {
		const task = await QueueTask.findOneAndDelete({ mediaGroupId });
		return task;
	}
}

module.exports = QueueManager;
