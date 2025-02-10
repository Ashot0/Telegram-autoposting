const { Telegraf } = require('telegraf'); // Импортируем Telegraf для работы с Telegram Bot API
const schedule = require('node-schedule'); // Импортируем node-schedule для планирования задач (cron-подобное планирование)
const { BOT_TOKEN, CHANNEL_ID, ADMIN_ID } = require('./config'); // Импортируем настройки бота: токен, ID канала и ID администратора
const { startServer } = require('./server');

const bot = new Telegraf(BOT_TOKEN); // Инициализируем бота с заданным токеном

// Объект для очереди отправляемых постов и групп медиа сообщений (альбомов)
let queue = {
	posts: [], // Массив для одиночных постов
	groups: {}, // Объект для групп медиа-сообщений (альбомов), сгруппированных по media_group_id
};
// Объект для хранения таймеров, связанных с группами медиа-сообщений
let groupTimers = {};

// Массив поддерживаемых типов медиа
const mediaTypes = [
	'photo',
	'video',
	'animation',
	'sticker',
	'audio',
	'document',
	'video_note',
	'voice',
];

// Функция для извлечения медиа из сообщения
const extractMedia = (message) => {
	return mediaTypes.reduce((acc, type) => {
		// Если сообщение содержит медиа нужного типа
		if (message[type]) {
			// Если медиа представлено в виде массива (например, несколько фото в альбоме)
			if (Array.isArray(message[type])) {
				acc.push({
					type,
					media: message[type][message[type].length - 1].file_id, // Берем file_id последнего элемента массива
				});
			} else {
				// Если медиа представлено одним объектом
				acc.push({
					type,
					media: message[type].file_id,
				});
			}
		}
		return acc;
	}, []);
};

// Функция для отправки медиа в канал (используется для отложенных сообщений)
const sendMediaToChannel = async (mediaMessage) => {
	try {
		// Проходим по каждому элементу медиа в сообщении
		for (const item of mediaMessage.media) {
			// Для некоторых типов медиа (например, стикеры и видео заметки) опция caption не поддерживается
			const options =
				item.type !== 'sticker' && item.type !== 'video_note'
					? { caption: mediaMessage.caption }
					: {};
			// Отправляем медиа в зависимости от его типа
			switch (item.type) {
				case 'photo':
					await bot.telegram.sendPhoto(CHANNEL_ID, item.media, options);
					break;
				case 'video':
					await bot.telegram.sendVideo(CHANNEL_ID, item.media, options);
					break;
				case 'animation':
					await bot.telegram.sendAnimation(CHANNEL_ID, item.media, options);
					break;
				case 'sticker':
					await bot.telegram.sendSticker(CHANNEL_ID, item.media);
					break;
				case 'audio':
					await bot.telegram.sendAudio(CHANNEL_ID, item.media, options);
					break;
				case 'document':
					await bot.telegram.sendDocument(CHANNEL_ID, item.media, options);
					break;
				case 'video_note':
					await bot.telegram.sendVideoNote(CHANNEL_ID, item.media);
					break;
				case 'voice':
					await bot.telegram.sendVoice(CHANNEL_ID, item.media, options);
					break;
				default:
					// Если тип медиа не поддерживается, выбрасываем ошибку
					throw new Error(`Unsupported media type: ${item.type}`);
			}
		}
		// Уведомляем администратора об успешной отправке медиа в канал
		await bot.telegram.sendMessage(ADMIN_ID, '✅ Медиа отправлено в канал!');
	} catch (error) {
		// В случае ошибки уведомляем администратора с описанием ошибки
		await bot.telegram.sendMessage(
			ADMIN_ID,
			`❌ Ошибка отправки медиа: ${error.message}`
		);
	}
};

// Обработчик входящих сообщений
bot.on('message', async (ctx) => {
	// Обрабатываем сообщения только от администратора
	if (ctx.chat.id !== ADMIN_ID) return;

	setTimeout(
		async () => {
			// Получаем caption (подпись) сообщения, если она есть
			const caption = ctx.message.caption || '';

			// Отложенная отправка медиа: ищем в подписи дату и время в формате "YYYY-MM-DD HH:mm"
			const dateTimeMatch = caption.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2})/);
			if (dateTimeMatch) {
				// Преобразуем найденную строку в объект Date
				const sendTime = new Date(dateTimeMatch[1]);

				// Проверяем корректность даты
				if (isNaN(sendTime.getTime())) {
					return ctx.reply(
						"❌ Неверный формат даты и времени. Пожалуйста, используйте формат 'YYYY-MM-DD HH:mm'."
					);
				}
				// Проверяем, что время отправки находится в будущем
				if (sendTime <= new Date()) {
					return ctx.reply(
						'❌ Время отправки уже наступило или находится в прошлом. Пожалуйста, выберите время в будущем.'
					);
				}

				// Извлекаем текст сообщения без даты и времени
				const textWithoutDateTime = caption
					.replace(dateTimeMatch[0], '')
					.trim();
				// Извлекаем медиа из сообщения
				const media = extractMedia(ctx.message);

				if (media.length > 0) {
					// Формируем объект медиа-сообщения для отложенной отправки
					const mediaMessage = {
						sendTime,
						media,
						caption: textWithoutDateTime,
					};
					// Добавляем сообщение в очередь
					schedule.scheduleJob(sendTime, async () => {
						await sendMediaToChannel(mediaMessage);
					});
					return ctx.reply(
						`✅ Медиа добавлено в очередь для отправки в ${sendTime.toLocaleString()}.`
					);
				} else {
					// Если в сообщении не найдено медиа, уведомляем администратора
					return ctx.reply('❌ В сообщении нет медиа для отложенной отправки.');
				}
			}

			// Обработка текстовых сообщений (без медиа, опросов, местоположений и т.д.)
			if (
				ctx.message.text && // сообщение содержит текст
				!ctx.message.photo && // нет фото
				!ctx.message.video && // нет видео
				!ctx.message.animation && // нет анимации
				!ctx.message.sticker && // нет стикера
				!ctx.message.poll && // нет опроса
				!ctx.message.audio && // нет аудио
				!ctx.message.document && // нет документа
				!ctx.message.location && // нет местоположения
				!ctx.message.contact && // нет контакта
				!ctx.message.venue && // нет места проведения
				!ctx.message.video_note && // нет видео-заметки
				!ctx.message.voice && // нет голосового сообщения
				!ctx.message.media_group_id // сообщение не является частью медиа-группы
			) {
				// Добавляем текстовое сообщение в очередь
				queue.posts.push({
					type: 'text',
					content: ctx.message.text,
					chatId: ctx.chat.id,
					messageId: ctx.message.message_id,
				});
				return ctx.reply(
					`✅ Текст добавлен в очередь! Всего постов: ${queue.posts.length}`
				);
			}

			// Обработка медиа-групп (альбомов)
			if (ctx.message.media_group_id) {
				const groupId = ctx.message.media_group_id;
				// Если группа с данным ID еще не создана, инициализируем ее
				if (!queue.groups[groupId]) {
					queue.groups[groupId] = {
						media: [],
						chatId: ctx.chat.id,
						messageIds: [],
					};
				}
				// Добавляем ID сообщения и извлеченное медиа в группу
				queue.groups[groupId].messageIds.push(ctx.message.message_id);
				queue.groups[groupId].media.push(...extractMedia(ctx.message));
				// Если для этой группы еще не установлен таймер, устанавливаем его
				if (!groupTimers[groupId]) {
					groupTimers[groupId] = setTimeout(async () => {
						if (queue.groups[groupId]) {
							// После истечения таймера добавляем группу медиа в очередь постов
							queue.posts.push({
								type: 'media_group',
								media: queue.groups[groupId].media,
								caption: caption,
								chatId: queue.groups[groupId].chatId,
								messageIds: queue.groups[groupId].messageIds,
							});
							// Удаляем группу и таймер, так как они больше не нужны
							delete queue.groups[groupId];
							delete groupTimers[groupId];
							// Уведомляем администратора об успешном добавлении альбома в очередь
							await bot.telegram.sendMessage(
								ADMIN_ID,
								`✅ Альбом добавлен в очередь! Всего постов: ${queue.posts.length}`
							);
						}
					}, 5000); // Задержка 5 секунд для сбора всех сообщений альбома
				}
				return;
			}

			// Обработка одиночных медиа-сообщений (не входящих в альбом)
			const media = extractMedia(ctx.message);
			if (media.length > 0) {
				queue.posts.push({
					type: 'media',
					media,
					caption,
					chatId: ctx.chat.id,
					messageId: ctx.message.message_id,
				});
				return ctx.reply(
					`✅ Медиа добавлено в очередь! Всего постов: ${queue.posts.length}`
				);
			}

			// Обработка сообщений с местоположением
			if (ctx.message.location) {
				queue.posts.push({
					type: 'location',
					latitude: ctx.message.location.latitude,
					longitude: ctx.message.location.longitude,
					chatId: ctx.chat.id,
					messageId: ctx.message.message_id,
				});
				return ctx.reply(
					`✅ Местоположение добавлено в очередь! Всего постов: ${queue.posts.length}`
				);
			}

			// Обработка опросов
			if (ctx.message.poll) {
				const poll = ctx.message.poll;
				queue.posts.push({
					type: 'poll',
					question: poll.question,
					options: poll.options.map((option) => option.text),
					isAnonymous: poll.is_anonymous,
					allowsMultipleAnswers: poll.allows_multiple_answers,
					chatId: ctx.chat.id,
					messageId: ctx.message.message_id,
				});
				return ctx.reply(
					`✅ Опрос добавлен в очередь! Всего постов: ${queue.posts.length}`
				);
			}

			// Обработка контактов
			if (ctx.message.contact) {
				queue.posts.push({
					type: 'contact',
					phoneNumber: ctx.message.contact.phone_number,
					firstName: ctx.message.contact.first_name,
					lastName: ctx.message.contact.last_name,
					chatId: ctx.chat.id,
					messageId: ctx.message.message_id,
				});
				return ctx.reply(
					`✅ Контакт добавлен в очередь! Всего постов: ${queue.posts.length}`
				);
			}

			// Обработка сообщений с местом проведения (venue)
			if (ctx.message.venue) {
				queue.posts.push({
					type: 'venue',
					latitude: ctx.message.venue.location.latitude,
					longitude: ctx.message.venue.location.longitude,
					title: ctx.message.venue.title,
					address: ctx.message.venue.address,
					chatId: ctx.chat.id,
					messageId: ctx.message.message_id,
				});
				return ctx.reply(
					`✅ Место добавлено в очередь! Всего постов: ${queue.posts.length}`
				);
			}
		},
		600000
		// 10000
	);
});

// Функция для отправки поста из очереди в канал
async function postToChannel() {
	// Если очередь пуста, выходим из функции
	if (queue.posts.length === 0) return;

	// Извлекаем первый пост из очереди
	const post = queue.posts.shift();
	// Функция для отправки уведомления администратору
	const sendMessageToAdmin = async (message) =>
		bot.telegram.sendMessage(ADMIN_ID, message);
	// Функция для удаления сообщения из чата
	const deleteMessage = async (chatId, messageId) => {
		try {
			await bot.telegram.deleteMessage(chatId, messageId);
			await sendMessageToAdmin(`✅ Сообщение ${messageId} удалено.`);
		} catch (err) {
			await sendMessageToAdmin(
				`❌ Не удалось удалить сообщение ${messageId}: ${err.message}`
			);
		}
	};

	try {
		// Деструктурируем свойства поста
		const {
			type,
			content,
			media,
			caption,
			question,
			options,
			isAnonymous,
			allowsMultipleAnswers,
			latitude,
			longitude,
			phoneNumber,
			firstName,
			lastName,
			title,
			address,
			chatId,
			messageId,
			messageIds,
		} = post;

		// Объект с методами отправки для каждого типа поста
		const sendMethods = {
			// Отправка текстового сообщения
			text: () => bot.telegram.sendMessage(CHANNEL_ID, content),
			// Отправка одиночного медиа-сообщения
			media: () => {
				const { type, media: mediaUrl } = media[0];
				const mediaOptions = caption ? { caption } : {};

				// Объект с методами отправки в зависимости от типа медиа
				const mediaActions = {
					photo: () =>
						bot.telegram.sendPhoto(CHANNEL_ID, mediaUrl, mediaOptions),
					video: () =>
						bot.telegram.sendVideo(CHANNEL_ID, mediaUrl, mediaOptions),
					animation: () =>
						bot.telegram.sendAnimation(CHANNEL_ID, mediaUrl, mediaOptions),
					sticker: () => bot.telegram.sendSticker(CHANNEL_ID, mediaUrl),
					audio: () =>
						bot.telegram.sendAudio(CHANNEL_ID, mediaUrl, mediaOptions),
					document: () =>
						bot.telegram.sendDocument(CHANNEL_ID, mediaUrl, mediaOptions),
					video_note: () => bot.telegram.sendVideoNote(CHANNEL_ID, mediaUrl),
					voice: () =>
						bot.telegram.sendVoice(CHANNEL_ID, mediaUrl, mediaOptions),
				};
				// Если тип медиа поддерживается, выполняем соответствующий метод, иначе генерируем ошибку
				return mediaActions[type]
					? mediaActions[type]()
					: Promise.reject(new Error(`Unsupported media type: ${type}`));
			},
			// Отправка группы медиа (альбома)
			media_group: () => {
				// Формируем массив объектов для отправки в виде медиа-группы
				const mediaGroup = media.map((item, index) => ({
					type: item.type,
					media: item.media,
					// К первому элементу добавляем caption, если он есть
					...(index === 0 && { caption }),
				}));
				return bot.telegram.sendMediaGroup(CHANNEL_ID, mediaGroup);
			},
			// Отправка опроса
			poll: () =>
				bot.telegram.sendPoll(CHANNEL_ID, question, options, {
					is_anonymous: isAnonymous,
					allows_multiple_answers: allowsMultipleAnswers,
				}),
			// Отправка местоположения
			location: () =>
				bot.telegram.sendLocation(CHANNEL_ID, latitude, longitude),
			// Отправка контакта
			contact: () =>
				bot.telegram.sendContact(CHANNEL_ID, phoneNumber, firstName, {
					last_name: lastName,
				}),
			// Отправка места (venue)
			venue: () =>
				bot.telegram.sendVenue(CHANNEL_ID, latitude, longitude, title, address),
		};

		// Если тип поста не поддерживается, выбрасываем ошибку
		if (!sendMethods[type]) throw new Error(`Unsupported post type: ${type}`);
		// Вызываем метод отправки, соответствующий типу поста
		await sendMethods[type]();
		await sendMessageToAdmin('✅ Пост отправлен!');

		// Удаляем исходные сообщения из чата (если это группа сообщений или одиночное сообщение)
		if (messageIds?.length) {
			await Promise.all(
				messageIds.map((msgId) => deleteMessage(chatId, msgId))
			);
		} else if (messageId) {
			await deleteMessage(chatId, messageId);
		}
	} catch (error) {
		// В случае ошибки уведомляем администратора
		await sendMessageToAdmin(`❌ Ошибка отправки поста: ${error.message}`);
	}
}

// Планируем выполнение функции postToChannel каждую минуту (cron-выражение "* * * * *")
schedule.scheduleJob('* * * * *', postToChannel);
startServer();
bot.launch(); // Запускаем бота
bot.telegram.sendMessage(ADMIN_ID, '🤖 Бот запущен!'); // Уведомляем администратора о запуске бота
