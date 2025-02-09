const { Telegraf } = require('telegraf');
const schedule = require('node-schedule');
const dotenv = require('dotenv');

dotenv.config(); // Загружаем переменные из .env

// ==== Настройки ====
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID; // Например, "@yourchannel"
const ADMIN_ID = Number(process.env.ADMIN_ID); // ID администратора

const bot = new Telegraf(BOT_TOKEN);

// Очередь постов хранится в памяти
// posts — массив готовых для отправки постов
// groups — временное хранилище для альбомных сообщений, ключ — media_group_id
// groupTimers — таймеры для групп, по которым через заданное время считается, что альбом завершён
let queue = {
	posts: [],
	groups: {},
};
let groupTimers = {};

// Обработчик входящих сообщений от администратора
bot.on('message', async (ctx) => {
	// Обрабатываем только сообщения от администратора
	if (ctx.chat.id !== ADMIN_ID) return;

	const caption = ctx.message.caption || '';

	// Если сообщение является частью альбома (имеет media_group_id)
	if (ctx.message.media_group_id) {
		const groupId = ctx.message.media_group_id;
		// Если это первое сообщение альбома — создаём объект для группы
		if (!queue.groups[groupId]) {
			queue.groups[groupId] = {
				media: [],
				chatId: ctx.chat.id,
				// Сохраним ID первого сообщения альбома (для последующего удаления)
				messageId: ctx.message.message_id,
			};
		}
		// Добавляем медиа: для фото берем изображение наилучшего качества
		if (ctx.message.photo) {
			queue.groups[groupId].media.push({
				type: 'photo',
				media: ctx.message.photo.pop().file_id,
			});
		}
		if (ctx.message.video) {
			queue.groups[groupId].media.push({
				type: 'video',
				media: ctx.message.video.file_id,
			});
		}

		// Если в одном из сообщений альбома появилась подпись, считаем альбом завершённым
		if (caption) {
			// Если ранее был установлен таймер — отменяем его
			if (groupTimers[groupId]) {
				clearTimeout(groupTimers[groupId]);
				delete groupTimers[groupId];
			}
			// Добавляем альбом в очередь с подписью
			queue.posts.push({
				media: queue.groups[groupId].media,
				caption: caption,
				chatId: queue.groups[groupId].chatId,
				messageId: queue.groups[groupId].messageId,
			});
			delete queue.groups[groupId];
			return ctx.reply(
				`✅ Альбом добавлен в очередь! Всего постов: ${queue.posts.length}`
			);
		} else {
			// Если подписи нет — устанавливаем таймер (если ещё не установлен)
			if (!groupTimers[groupId]) {
				groupTimers[groupId] = setTimeout(() => {
					if (queue.groups[groupId]) {
						queue.posts.push({
							media: queue.groups[groupId].media,
							caption: '', // пустая подпись
							chatId: queue.groups[groupId].chatId,
							messageId: queue.groups[groupId].messageId,
						});
						delete queue.groups[groupId];
						delete groupTimers[groupId];
						console.log(
							`✅ Альбом (без подписи) добавлен в очередь! Всего постов: ${queue.posts.length}`
						);
					}
				}, 5000); // ждем 5 секунд
			}
			// Не отправляем сразу ответ — дождемся таймера
			return;
		}
	}

	// Если сообщение не является частью альбома — обрабатываем одиночное фото/видео
	const media = [];
	if (ctx.message.photo) {
		media.push({ type: 'photo', media: ctx.message.photo.pop().file_id });
	}
	if (ctx.message.video) {
		media.push({ type: 'video', media: ctx.message.video.file_id });
	}
	if (media.length > 0) {
		queue.posts.push({
			media,
			caption,
			chatId: ctx.chat.id,
			messageId: ctx.message.message_id,
		});
		return ctx.reply(
			`✅ Добавлено в очередь! Всего постов: ${queue.posts.length}`
		);
	}
});

// Функция отправки поста в канал и удаления исходного сообщения
async function postToChannel() {
	if (queue.posts.length === 0) return;

	// Извлекаем первый пост из очереди
	const { media, caption, chatId, messageId } = queue.posts.shift();

	try {
		if (media.length > 1) {
			// Если медиа несколько — отправляем группой
			await bot.telegram.sendMediaGroup(CHANNEL_ID, media);
			if (caption) {
				await bot.telegram.sendMessage(CHANNEL_ID, caption);
			}
		} else {
			const first = media[0];
			if (first.type === 'photo') {
				await bot.telegram.sendPhoto(CHANNEL_ID, first.media, { caption });
			} else if (first.type === 'video') {
				await bot.telegram.sendVideo(CHANNEL_ID, first.media, { caption });
			}
		}
		console.log('✅ Пост отправлен!');

		// Пытаемся удалить исходное сообщение из чата администратора
		try {
			await bot.telegram.deleteMessage(chatId, messageId);
			console.log('✅ Исходное сообщение удалено.');
		} catch (err) {
			console.error('❌ Не удалось удалить сообщение:', err);
		}
	} catch (error) {
		console.error('❌ Ошибка отправки поста:', error);
	}
}

// Планировщик: отправка поста каждый час (на 0-й минуте каждого часа)
schedule.scheduleJob('* * * * *', postToChannel);

bot.launch();
console.log('🤖 Бот запущен!');
