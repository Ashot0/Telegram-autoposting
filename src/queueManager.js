const { Markup } = require('telegraf');
const { getFileId } = require('./utils/getFileId');
const { sendReply } = require('./services/Sends');
const { getIsPaused } = require('./managers/pauseManager');
const QueueTask = require('./models/QueueTask');
const { connect } = require('./db');
const { ADMIN_ID } = require('./config');

class QueueManager {
	constructor() {
		this.mediaGroups = new Map();
		this.processingGroups = new Set();
		connect().catch(console.error);
	}

	async isMediaGroupDuplicate(newMedia) {
		const newFileIds = newMedia.map((item) => item.media).sort();
		const tasks = await QueueTask.find({});
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
		}));
	}

	async processMediaGroup(message, mediaGroupId, mediaArray) {
		if (this.processingGroups.has(mediaGroupId)) {
			return; // Уже обрабатывается
		}
		this.processingGroups.add(mediaGroupId);

		const mediaType = ['photo', 'video', 'document', 'audio'].find(
			(type) => message[type]
		);

		const fileId = getFileId(message);
		if (!fileId) {
			sendReply(message, '❌ Не удалось получить file_id для медиа');
			return;
		}
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
				const groupMedia = this.mediaGroups.get(mediaGroupId);
				if (groupMedia?.length > 0) {
					if (await this.isMediaGroupDuplicate(groupMedia)) {
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
						this.mediaGroups.delete(mediaGroupId);
						return;
					}
					try {
						const task = new QueueTask({
							chatId: message.chat.id,
							media: groupMedia,
							mediaGroupId,
							createdAt: new Date(),
						});
						await task.save();

						this.mediaGroups.delete(mediaGroupId);
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
					} catch (error) {
						if (error.code === 11000) {
							// Ошибка дубликата
							await this.cleanupMediaGroup(message, groupMedia);
						}
					} finally {
						this.processingGroups.delete(mediaGroupId);
					}
				}
			}, 5000);
		} else {
			sendReply(message, '❌ Ошибка: Не удалось определить `file_id`.');
		}
	}

	async sendMessageFromQueue(bot, ADMIN_ID, sendMediaGroup, sendMessage) {
		if (getIsPaused()) {
			console.log('[PAUSE] Рассылка приостановлена');
			return;
		}

		const task = await QueueTask.findOne().sort({ createdAt: 1 });
		if (!task) return;

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
					await bot.telegram.deleteMessage(
						task.chatId,
						task.media[0].messageId
					);
				} catch (error) {
					console.error(`[ERROR] Удаление: ${error.message}`);
				}
			}

			await QueueTask.deleteOne({ _id: task._id });
			sendReply(
				ADMIN_ID,
				`✅ Сообщение переслано! В очереди ${await QueueTask.countDocuments()}`
			);
		} catch (error) {
			console.error(`[ERROR] Отправка: ${error.message}`);
			sendReply(ADMIN_ID, `❌ Ошибка: ${error.message}`);
		}
	}

	async addToQueue(task) {
		try {
			const newTask = new QueueTask(task);
			await newTask.save();
		} catch (error) {
			console.error('Ошибка добавления в очередь:', error);
			sendReply(ADMIN_ID, `❌ Ошибка: ${error.message}`);
		}
	}

	async removeFromQueue(messageId) {
		await QueueTask.deleteOne({ 'media.messageId': messageId });
	}

	async removeMediaGroupFromQueue(mediaGroupId) {
		await QueueTask.deleteOne({ mediaGroupId });
	}

	async getQueue() {
		return await QueueTask.find({}).sort({ createdAt: 1 }).exec();
	}

	async updateTask(updatedTask) {
		await QueueTask.updateOne(
			{ _id: updatedTask._id }, // Ищем задачу по её ID
			{ $set: { media: updatedTask.media } } // Обновляем поле media
		);
	}
}

module.exports = QueueManager;
