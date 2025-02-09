const { Telegraf } = require('telegraf');
const schedule = require('node-schedule');
const dotenv = require('dotenv');

dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const ADMIN_ID = Number(process.env.ADMIN_ID);

const bot = new Telegraf(BOT_TOKEN);

let queue = {
	posts: [],
	groups: {},
};
let groupTimers = {};

bot.on('message', async (ctx) => {
	if (ctx.chat.id !== ADMIN_ID) return;

	const caption = ctx.message.caption || '';

	// Обработка текстовых сообщений
	if (
		ctx.message.text &&
		!ctx.message.photo &&
		!ctx.message.video &&
		!ctx.message.animation &&
		!ctx.message.sticker &&
		!ctx.message.poll &&
		!ctx.message.audio &&
		!ctx.message.document &&
		!ctx.message.location &&
		!ctx.message.contact &&
		!ctx.message.venue &&
		!ctx.message.video_note &&
		!ctx.message.voice &&
		!ctx.message.media_group_id
	) {
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

	// Обработка медиа-групп (альбомов)
	if (ctx.message.media_group_id) {
		const groupId = ctx.message.media_group_id;

		if (!queue.groups[groupId]) {
			queue.groups[groupId] = {
				media: [],
				chatId: ctx.chat.id,
				messageIds: [],
			};
		}

		queue.groups[groupId].messageIds.push(ctx.message.message_id);

		if (ctx.message.photo) {
			const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
			queue.groups[groupId].media.push({ type: 'photo', media: fileId });
		}
		if (ctx.message.video) {
			queue.groups[groupId].media.push({
				type: 'video',
				media: ctx.message.video.file_id,
			});
		}
		if (ctx.message.animation) {
			queue.groups[groupId].media.push({
				type: 'animation',
				media: ctx.message.animation.file_id,
			});
		}
		if (ctx.message.sticker) {
			queue.groups[groupId].media.push({
				type: 'sticker',
				media: ctx.message.sticker.file_id,
			});
		}
		if (ctx.message.audio) {
			queue.groups[groupId].media.push({
				type: 'audio',
				media: ctx.message.audio.file_id,
			});
		}
		if (ctx.message.document) {
			queue.groups[groupId].media.push({
				type: 'document',
				media: ctx.message.document.file_id,
			});
		}
		if (ctx.message.video_note) {
			queue.groups[groupId].media.push({
				type: 'video_note',
				media: ctx.message.video_note.file_id,
			});
		}

		if (ctx.message.voice) {
			queue.groups[groupId].media.push({
				type: 'voice',
				media: ctx.message.voice.file_id,
			});
		}
		if (!groupTimers[groupId]) {
			groupTimers[groupId] = setTimeout(async () => {
				if (queue.groups[groupId]) {
					queue.posts.push({
						type: 'media_group',
						media: queue.groups[groupId].media,
						caption,
						chatId: queue.groups[groupId].chatId,
						messageIds: queue.groups[groupId].messageIds,
					});
					delete queue.groups[groupId];
					delete groupTimers[groupId];
					await bot.telegram.sendMessage(
						ADMIN_ID,
						`✅ Альбом добавлен в очередь! Всего постов: ${queue.posts.length}`
					);
				}
			}, 5000);
		}
		return;
	}

	// Обработка одиночных медиа-сообщений
	const media = [];
	if (ctx.message.photo) {
		const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
		media.push({ type: 'photo', media: fileId });
	}
	if (ctx.message.video) {
		media.push({ type: 'video', media: ctx.message.video.file_id });
	}
	if (ctx.message.animation) {
		media.push({ type: 'animation', media: ctx.message.animation.file_id });
	}
	if (ctx.message.sticker) {
		media.push({ type: 'sticker', media: ctx.message.sticker.file_id });
	}
	if (ctx.message.audio) {
		media.push({ type: 'audio', media: ctx.message.audio.file_id });
	}
	if (ctx.message.document) {
		media.push({ type: 'document', media: ctx.message.document.file_id });
	}
	if (ctx.message.video_note) {
		media.push({ type: 'video_note', media: ctx.message.video_note.file_id });
	}
	if (ctx.message.voice) {
		media.push({ type: 'voice', media: ctx.message.voice.file_id });
	}

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
	// Обработка местоположения
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

	// Обработка контакта
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

	// Обработка места (venue)
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
});
//
async function postToChannel() {
	if (queue.posts.length === 0) return;

	const post = queue.posts.shift();

	try {
		switch (post.type) {
			case 'text':
				await bot.telegram.sendMessage(CHANNEL_ID, post.content);
				break;
			case 'media':
				const firstMedia = post.media[0];
				switch (firstMedia.type) {
					case 'photo':
						await bot.telegram.sendPhoto(CHANNEL_ID, firstMedia.media, {
							caption: post.caption,
						});
						break;
					case 'video':
						await bot.telegram.sendVideo(CHANNEL_ID, firstMedia.media, {
							caption: post.caption,
						});
						break;
					case 'animation':
						await bot.telegram.sendAnimation(CHANNEL_ID, firstMedia.media, {
							caption: post.caption,
						});
						break;
					case 'sticker':
						await bot.telegram.sendSticker(CHANNEL_ID, firstMedia.media);
						break;
					case 'audio':
						await bot.telegram.sendAudio(CHANNEL_ID, firstMedia.media, {
							caption: post.caption,
						});
						break;
					case 'document':
						await bot.telegram.sendDocument(CHANNEL_ID, firstMedia.media, {
							caption: post.caption,
						});
						break;
					case 'video_note':
						await bot.telegram.sendVideoNote(CHANNEL_ID, firstMedia.media);
						break;
					case 'voice':
						await bot.telegram.sendVoice(CHANNEL_ID, firstMedia.media, {
							caption: post.caption,
						});
						break;
					default:
						throw new Error(`Unsupported media type: ${firstMedia.type}`);
				}
				break;
			case 'media_group':
				const mediaGroup = post.media.map((item, index) => ({
					type: item.type,
					media: item.media,
					...(index === 0 && { caption: post.caption }),
				}));
				await bot.telegram.sendMediaGroup(CHANNEL_ID, mediaGroup);
				break;
			case 'poll':
				await bot.telegram.sendPoll(CHANNEL_ID, post.question, post.options, {
					is_anonymous: post.isAnonymous,
					allows_multiple_answers: post.allowsMultipleAnswers,
				});
				break;
			case 'location':
				await bot.telegram.sendLocation(
					CHANNEL_ID,
					post.latitude,
					post.longitude
				);
				break;
			case 'contact':
				await bot.telegram.sendContact(
					CHANNEL_ID,
					post.phoneNumber,
					post.firstName,
					{ last_name: post.lastName }
				);
				break;
			case 'venue':
				await bot.telegram.sendVenue(
					CHANNEL_ID,
					post.latitude,
					post.longitude,
					post.title,
					post.address
				);
				break;
			default:
				throw new Error(`Unsupported post type: ${post.type}`);
		}

		await bot.telegram.sendMessage(ADMIN_ID, '✅ Пост отправлен!');

		if (post.messageIds && post.messageIds.length > 0) {
			for (const messageId of post.messageIds) {
				try {
					await bot.telegram.deleteMessage(post.chatId, messageId);
					await bot.telegram.sendMessage(
						ADMIN_ID,
						`✅ Сообщение ${messageId} удалено.`
					);
				} catch (err) {
					await bot.telegram.sendMessage(
						ADMIN_ID,
						`❌ Не удалось удалить сообщение ${messageId}: ${err.message}`
					);
				}
			}
		} else {
			try {
				await bot.telegram.deleteMessage(post.chatId, post.messageId);
				await bot.telegram.sendMessage(
					ADMIN_ID,
					'✅ Исходное сообщение удалено.'
				);
			} catch (err) {
				await bot.telegram.sendMessage(
					ADMIN_ID,
					`❌ Не удалось удалить сообщение: ${err.message}`
				);
			}
		}
	} catch (error) {
		await bot.telegram.sendMessage(
			ADMIN_ID,
			`❌ Ошибка отправки поста: ${error.message}`
		);
	}
}

schedule.scheduleJob('* * * * *', postToChannel);

bot.launch();
bot.telegram.sendMessage(ADMIN_ID, '🤖 Бот запущен!');
