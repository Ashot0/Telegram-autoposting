const { Telegraf } = require('telegraf');
const { Markup } = require('telegraf');
const schedule = require('node-schedule');
const punycode = require('punycode/');
const moment = require('moment');
const { startServer } = require('./server');
const {
	createMediaItem,
	getFileId,
	removeScheduleDate,
	sortAndNormalizeMediaGroup,
} = require('./mediaUtils');
const {
	BOT_TOKEN,
	CHANNEL_ID,
	ADMIN_ID,
	SEND_TIMER,
	SEND_COOLDOWN,
	TIME_ZONE,
} = require('./config');

const bot = new Telegraf(BOT_TOKEN);
let queue = [];
let mediaGroups = new Map();
let isPaused = false;
let keyboardMessageId = null;
let pendingScheduledDeliveries = [];

// Импортируем функции отправки
const {
	sendMessage,
	sendMediaGroup,
	copyMediaGroup,
	sendReply,
	sendReplyWithDeleteButton,
	getAdminLogMessages,
	clearAdminLogMessages,
} = require('./Sends');
// Функция для отправки обычного сообщения

schedule.scheduleJob('0 3 * * *', async () => {
	console.log('[CLEAN] Запущено удаление лог-сообщений администратора');

	// Получаем сохранённые идентификаторы сообщений
	const adminLogMessages = getAdminLogMessages();

	console.log('[CLEAN] adminLogMessages', adminLogMessages);

	// Проходим по списку сохранённых идентификаторов
	for (const msgId of adminLogMessages) {
		try {
			await bot.telegram.deleteMessage(ADMIN_ID, msgId);
			console.log(`[CLEAN] Удалено сообщение с id ${msgId}`);
		} catch (error) {
			console.error(
				`[ERROR] Ошибка при удалении сообщения ${msgId}: ${error.message}`
			);
		}
	}

	// Очищаем лог-сообщения после удаления
	clearAdminLogMessages();
});

function isMediaGroupDuplicate(newMedia) {
	// Собираем fileId из новой медиагруппы и сортируем для корректного сравнения
	const newFileIds = newMedia.map((item) => item.media).sort();
	return queue.some((task) => {
		// Если задание не является медиагруппой или количество файлов отличается, пропускаем
		if (!task.media || task.media.length !== newMedia.length) return false;
		const taskFileIds = task.media.map((item) => item.media).sort();
		// Сравниваем каждый fileId
		return newFileIds.every((id, index) => id === taskFileIds[index]);
	});
}

function getPauseKeyboard() {
	return Markup.inlineKeyboard([
		Markup.button.callback(
			isPaused ? '▶️ Возобновить' : '⏸️ Пауза',
			'toggle_pause'
		),
	]);
}

function getScheduledDate(match) {
	const [, day, month, year, hour, minute] = match;
	return moment(
		`${year}-${month}-${day} ${hour}:${minute}`,
		'YYYY-MM-DD HH:mm',
		true
	).utcOffset(TIME_ZONE, true);
}

async function runOrDeferScheduled(delivery, message) {
	if (isPaused) {
		pendingScheduledDeliveries.push(delivery);
		await sendReply(message, '⏸️ Время отправки наступило. Публикация ожидает снятия паузы.');
		return;
	}

	await delivery();
}

async function flushPendingScheduledDeliveries() {
	const deliveries = pendingScheduledDeliveries;
	pendingScheduledDeliveries = [];
	for (const delivery of deliveries) {
		try {
			await delivery();
		} catch (error) {
			console.error(`[ERROR] Ошибка отложенной паузой отправки: ${error.message}`);
		}
	}
}

async function deleteSourceMessages(task) {
	for (const mediaItem of task.media) {
		if (!mediaItem.messageId) continue;
		try {
			await bot.telegram.deleteMessage(task.chatId, mediaItem.messageId);
		} catch (error) {
			console.error(
				`[ERROR] Ошибка при удалении ${mediaItem.messageId}: ${error.message}`
			);
		}
	}
}

async function deliverMediaTask(task) {
	if (task.media.length > 1) {
		await sendMediaGroup(task.media);
	} else {
		const item = task.media[0];
		await sendMessage(
			task.chatId,
			item.messageId,
			item.caption,
			item.caption_entities,
			item.show_caption_above_media,
			item.has_media_spoiler
		);
	}
	await deleteSourceMessages(task);
}

function enqueueOrScheduleMediaGroup(message, mediaGroupId, groupMedia) {
	const task = {
		chatId: message.chat.id,
		media: groupMedia,
		mediaGroupId,
	};
	const firstItem = groupMedia[0];
	const scheduleData = removeScheduleDate(
		firstItem.caption || '',
		firstItem.caption_entities || []
	);

	if (!scheduleData) {
		queue.push(task);
		return false;
	}

	const sendDate = getScheduledDate(scheduleData.match);
	if (!sendDate.isValid() || sendDate.diff(moment(), 'milliseconds') <= 0) {
		sendReply(message, '❌ Указанная дата некорректна или уже прошла.');
		return true;
	}

	firstItem.caption = scheduleData.text;
	if (scheduleData.entities.length) {
		firstItem.caption_entities = scheduleData.entities;
	} else {
		delete firstItem.caption_entities;
	}

	schedule.scheduleJob(sendDate.toDate(), () =>
		runOrDeferScheduled(async () => {
			await deliverMediaTask(task);
			await sendReply(message, '✅ Медиагруппа отправлена по расписанию!');
		}, message).catch((error) => {
			console.error(`[ERROR] Ошибка отправки медиагруппы по расписанию: ${error.message}`);
		})
	);
	sendReply(message, `⏳ Отправка медиагруппы в ${sendDate.format()}`);
	return true;
}

// Функция для обработки медиагруппы
function processMediaGroup(message, mediaGroupId) {
	const mediaItem = createMediaItem(message);
	if (mediaItem) {
		let group = mediaGroups.get(mediaGroupId);
		if (!group) {
			group = { chatId: message.chat.id, media: [], timer: null };
			mediaGroups.set(mediaGroupId, group);
		}

		group.media.push(mediaItem);
		clearTimeout(group.timer);
		group.timer = setTimeout(async () => {
			const pendingGroup = mediaGroups.get(mediaGroupId);
			if (pendingGroup && pendingGroup.media.length > 0) {
				const groupMedia = sortAndNormalizeMediaGroup(pendingGroup.media);
				mediaGroups.delete(mediaGroupId);
				if (isMediaGroupDuplicate(groupMedia)) {
					// Удаляем ВСЕ сообщения медиагруппы из чата администратора
					for (const mediaItem of groupMedia) {
						try {
							await bot.telegram.deleteMessage(
								message.chat.id, // message.chat.id - это чат администратора
								mediaItem.messageId
							);
							console.log(`[DELETE] Удален дубликат: ${mediaItem.messageId}`);
						} catch (error) {
							// Не знаешь => не трогай
						}
					}

					await sendReply(
						message,
						'❌ Медиагруппа уже в очереди. Сообщения удалены.'
					);
					return;
				}
				const wasScheduled = enqueueOrScheduleMediaGroup(
					message,
					mediaGroupId,
					groupMedia
				);
				if (wasScheduled) return;
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

// Основная функция для обработки сообщений из очереди
async function sendMessageFromQueue() {
	if (isPaused) {
		console.log('[PAUSE] Рассылка приостановлена');
		return;
	}

	if (queue.length === 0) {
		console.log('[QUEUE] Очередь пуста, ничего не отправляем.');
		return;
	}

	const task = queue.shift();
	console.log(
		`[QUEUE] Отправляем сообщение из очереди: ${JSON.stringify(task)}`
	);

	try {
		if (task.media.length > 1) {
			console.log(
				`[QUEUE] Обнаружена медиагруппа (${task.media.length} файлов), отправляем...`
			);
			// Удаляем подписи у всех элементов кроме первого
			task.media.forEach((item, index) => {
				if (index > 0) {
					delete item.caption;
					delete item.caption_entities;
					delete item.show_caption_above_media;
				}
			});

			await copyMediaGroup(task.chatId, task.media);
			console.log('[QUEUE] Медиагруппа успешно отправлена!');

			// Удаление исходных сообщений из чата
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
				} else {
					console.error(
						`[ERROR] Нет messageId для удаления: ${JSON.stringify(mediaItem)}`
					);
				}
			}
		} else {
			console.log(
				`[QUEUE] Отправляем одиночное сообщение: ${task.media[0].messageId}`
			);

			//
			await sendMessage(
				task.chatId,
				task.media[0].messageId
			);
			console.log(
				`[QUEUE] Сообщение ${task.media[0].messageId} успешно отправлено!`
			);
			try {
				await bot.telegram.deleteMessage(task.chatId, task.media[0].messageId);
				console.log(
					`[DELETE] Одиночное сообщение удалено: ${task.media[0].messageId}`
				);
			} catch (error) {
				console.error(
					`[ERROR] Ошибка при удалении ${task.media[0].messageId}: ${error.message}`
				);
			}
		}

		sendReply(
			ADMIN_ID,
			`✅ Сообщение переслано и удалено! В очереди ${queue.length}`
		);
	} catch (error) {
		console.error(`[ERROR] Ошибка при отправке сообщения: ${error.message}`);
		sendReply(ADMIN_ID, `❌ Ошибка: ${error.message}`);
	}
}

async function sendPauseKeyboard(ctx) {
	const keyboard = getPauseKeyboard();
	const messageText = '🤖 Управление рассылкой:';

	try {
		if (keyboardMessageId) {
			await bot.telegram.editMessageReplyMarkup(
				ADMIN_ID,
				keyboardMessageId,
				null,
				keyboard.reply_markup
			);
		} else {
			const sentMessage = await bot.telegram.sendMessage(
				ADMIN_ID,
				messageText,
				keyboard
			);
			keyboardMessageId = sentMessage.message_id;
		}
	} catch (error) {
		if (error.description?.includes('message to edit not found')) {
			const sentMessage = await bot.telegram.sendMessage(
				ADMIN_ID,
				messageText,
				keyboard
			);
			keyboardMessageId = sentMessage.message_id;
		} else {
			console.error('Ошибка клавиатуры:', error);
		}
	}
}

schedule.scheduleJob(SEND_TIMER, sendMessageFromQueue);

bot.on('message', async (ctx) => {
	if (ctx.chat.id !== ADMIN_ID) return;

	// Фильтруем сообщения-команды, чтобы они не попадали в очередь
	const text = ctx.message.text;
	if (text === '⏸️ Пауза' || text === '▶️ Возобновить') {
		isPaused = !isPaused;

		// Отправляем временное сообщение
		const tempMessage = await ctx.reply(
			isPaused ? '⏸️ Рассылка приостановлена' : '▶️ Рассылка возобновлена'
		);

		// Удаляем временное сообщение через 2 секунды
		// setTimeout(async () => {
		// 	try {
		// 		await ctx.deleteMessage(tempMessage.message_id);
		// 	} catch (error) {
		// 		console.error('Ошибка удаления:', error);
		// 	}
		// }, 2000);

		// Обновляем основную клавиатуру
		await sendPauseKeyboard(ctx);
		await ctx.deleteMessage(); // Удаляем сообщение с кнопкой
		if (!isPaused) await flushPendingScheduledDeliveries();
		return;
	}

	setTimeout(() => {
		const { message } = ctx;
		const mediaGroupId = message.media_group_id;
		const caption = message.caption || message.text || '';
		const newMessageFileId = getFileId(message);

		// Все части альбома должны попасть в один накопитель, включая часть с датой.
		if (mediaGroupId) {
			processMediaGroup(message, mediaGroupId);
			return;
		}

		// Проверяем, есть ли в очереди сообщение с таким же id, текстом или изображением
		const isMessageInQueue = queue.some((task) => {
			const taskMedia = task.media[0];
			const taskMessageContent = taskMedia.caption || '';
			const taskFileId = taskMedia.fileId || null;
			return (
				taskMedia.messageId === message.message_id ||
				(caption != '#вагонетка_дня' &&
					taskMessageContent === caption &&
					newMessageFileId &&
					taskFileId === newMessageFileId) ||
				(newMessageFileId && taskFileId === newMessageFileId)
			);
		});

		if (isMessageInQueue) {
			sendReply(message, '❌ Такое сообщение уже присутствует в очереди')
				.then(() =>
					bot.telegram.deleteMessage(message.chat.id, message.message_id)
				)
				.then(() => {
					return;
				});
			return;
		}

		const scheduleData = removeScheduleDate(
			caption,
			message.caption_entities || message.entities || []
		);

		if (scheduleData) {
			const processedContent = scheduleData.text;
			const sendDate = getScheduledDate(scheduleData.match);

			// Отображаемая дата
			sendReply(message, `⏳ Отправка сообщения в ${sendDate}`);

			const delay = sendDate.diff(moment(), 'milliseconds');

			if (sendDate.isValid() && delay > 0) {
				schedule.scheduleJob(sendDate.toDate(), () =>
					runOrDeferScheduled(async () => {
						if (message.caption) {
							await sendMessage(
								message.chat.id,
								message.message_id,
								processedContent,
								scheduleData.entities.length ? scheduleData.entities : undefined,
								message.show_caption_above_media,
								message.has_media_spoiler
							);
						} else if (message.text) {
							await bot.telegram.sendMessage(CHANNEL_ID, processedContent, {
								entities: scheduleData.entities,
							});
						}
						try {
							await bot.telegram.deleteMessage(
								message.chat.id,
								message.message_id
							);

							console.log(
								`[DELETE] Одиночное сообщение удалено: ${message.message_id}`
							);
						} catch (error) {
							console.error(
								`[ERROR] Ошибка при удалении ${message.message_id}: ${error.message}`
							);
						}
						await sendReply(message, '✅ Сообщение отправлено по расписанию!');
					}, message).catch((error) => {
						console.error(`[ERROR] Ошибка отправки по расписанию: ${error.message}`);
					})
				);
			} else {
				sendReply(message, '❌ Указанная дата некорректна или уже прошла.');
			}
		} else {
			// Если даты нет, просто добавляем в очередь
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

	if (!keyboardMessageId) {
		await sendPauseKeyboard(ctx);
	}
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

bot.action('toggle_pause', async (ctx) => {
	if (ctx.from?.id !== ADMIN_ID) {
		await ctx.answerCbQuery('Недостаточно прав.');
		return;
	}

	isPaused = !isPaused;
	const keyboard = getPauseKeyboard();

	try {
		await ctx.editMessageReplyMarkup(keyboard.reply_markup);
		await ctx.answerCbQuery(
			isPaused ? '⏸️ Рассылка приостановлена' : '▶️ Рассылка возобновлена'
		);
		if (!isPaused) await flushPendingScheduledDeliveries();
	} catch (error) {
		console.error('Ошибка при обновлении кнопки:', error);
	}
});

startServer();

bot.telegram.sendMessage(ADMIN_ID, '🤖 Бот запущен!');
bot.launch().then(async () => {
	const initialMessage = await bot.telegram.sendMessage(
		ADMIN_ID,
		'🤖 Управление рассылкой:',
		getPauseKeyboard()
	);
	keyboardMessageId = initialMessage.message_id;
});
