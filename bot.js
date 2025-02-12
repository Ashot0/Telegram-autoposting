const { Telegraf } = require("telegraf");
const schedule = require("node-schedule");
const {
  BOT_TOKEN,
  CHANNEL_ID,
  ADMIN_ID,
  SEND_TIMER,
  SEND_COOLDOWN,
  TIME_ZONE,
} = require("./config");
const { startServer } = require("./server");
const moment = require("moment"); // Для удобной работы с датами

const bot = new Telegraf(BOT_TOKEN);
let queue = [];
let mediaGroups = new Map();

// Функция для отправки обычного сообщения
async function sendMessage(chatId, messageId, caption) {
  try {
    await bot.telegram.copyMessage(CHANNEL_ID, chatId, messageId, { caption });
  } catch (error) {
    throw new Error(`Ошибка при отправке сообщения: ${error.message}`);
  }
}

// Функция для отправки медиагруппы
async function sendMediaGroup(media) {
  if (!media || media.length === 0) {
    throw new Error("Медиагруппа пуста");
  }
  try {
    await bot.telegram.sendMediaGroup(CHANNEL_ID, media);
  } catch (error) {
    throw new Error(`Ошибка при отправке медиагруппы: ${error.message}`);
  }
}

// Функция для отправки ответа пользователю
async function sendReply(message, text) {
  try {
    await bot.telegram.sendMessage(message.chat.id, text);
  } catch (error) {
    console.error("Ошибка при отправке ответа:", error.message);
  }
}

// Функция для получения fileId для медиафайлов
function getFileId(message) {
  const mediaType = ["photo", "video", "document", "audio"].find(
    (type) => message[type]
  );
  if (!mediaType) return null;
  const mediaContent = message[mediaType];
  if (Array.isArray(mediaContent)) {
    return mediaContent[mediaContent.length - 1].file_id;
  } else {
    return mediaContent.file_id;
  }
}

// Функция для обработки медиагруппы
function processMediaGroup(message, mediaGroupId, mediaArray) {
  const mediaType = ["photo", "video", "document", "audio"].find(
    (type) => message[type]
  );
  const fileId = getFileId(message);
  if (fileId) {
    mediaArray.push({
      type: mediaType,
      media: fileId,
      messageId: message.message_id, // Сохраняем messageId
      has_media_spoiler: message.has_media_spoiler || false,
      // Telegram разрешает подпись только у первого элемента
      caption:
        mediaArray.length === 0
          ? message.caption || message.text || ""
          : undefined,
      caption_entities:
        mediaArray.length === 0
          ? message.caption_entities || undefined
          : undefined,
      show_caption_above_media:
        mediaArray.length === 0
          ? message.show_caption_above_media || false
          : undefined,
    });

    // Даем время на поступление остальных сообщений из группы
    setTimeout(() => {
      const groupMedia = mediaGroups.get(mediaGroupId);
      if (groupMedia && groupMedia.length > 0) {
        // Добавляем медиагруппу в очередь
        queue.push({
          chatId: message.chat.id,
          media: groupMedia,
        });
        mediaGroups.delete(mediaGroupId);
        sendReply(message, "✅ Медиафайлы добавлены в очередь.");
      }
    }, 2000);
  } else {
    sendReply(message, "❌ Ошибка: Не удалось определить `file_id`.");
  }
}

// Основная функция для обработки сообщений из очереди
async function sendMessageFromQueue() {
  if (queue.length === 0) {
    console.log("[QUEUE] Очередь пуста, ничего не отправляем.");
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

      await sendMediaGroup(task.media);
      console.log("[QUEUE] Медиагруппа успешно отправлена!");

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

      await sendMessage(
        task.chatId,
        task.media[0].messageId,
        task.media[0].caption || ""
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
    await bot.telegram.sendMessage(
      ADMIN_ID,
      `✅ Сообщение переслано и удалено! В очереди ${queue.length}`
    );
  } catch (error) {
    console.error(`[ERROR] Ошибка при отправке сообщения: ${error.message}`);
    await bot.telegram.sendMessage(ADMIN_ID, `❌ Ошибка: ${error.message}`);
  }
}

schedule.scheduleJob(SEND_TIMER, sendMessageFromQueue);

bot.on("message", async (ctx) => {
  if (ctx.chat.id !== ADMIN_ID) return;

  setTimeout(() => {
    const { message } = ctx;
    const mediaGroupId = message.media_group_id;
    const caption = message.caption || message.text || "";

    // Ищем дату в формате "день-месяц-год час:минута"
    const dateRegex = /(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2})/;
    const match = caption.match(dateRegex);

    if (match) {
      const [_, day, month, year, hour, minute] = match;
      const sendDate = moment(
        `${year}-${month}-${day} ${hour + TIME_ZONE}:${minute}`,
        "YYYY-MM-DD HH:mm"
      );
      sendReply(message, `⏳ Отправка сообщения в ${sendDate}`);

      const newCaption = caption.replace(dateRegex, "").trim();
      const delay = sendDate.diff(moment(), "milliseconds");

      if (delay > 0) {
        schedule.scheduleJob(sendDate.toDate(), async () => {
          if (mediaGroupId) {
            const groupMedia = mediaGroups.get(mediaGroupId);
            if (groupMedia && groupMedia.length > 0) {
              await sendMediaGroup(groupMedia);
              setTimeout(() => { mediaGroups.delete(mediaGroupId); }, 5000)
            }
          } else {
            await sendMessage(message.chat.id, message.message_id, newCaption);
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
          }
          sendReply(message, "✅ Сообщение отправлено по расписанию!");
        });
      } else {
        sendReply(message, "❌ Указанная дата уже прошла.");
      }
    } else if (mediaGroupId) {
      // Обработка медиагруппы
      if (!mediaGroups.has(mediaGroupId)) {
        mediaGroups.set(mediaGroupId, []);
      }
      const mediaArray = mediaGroups.get(mediaGroupId);
      processMediaGroup(message, mediaGroupId, mediaArray);
    } else {
      // Если даты нет, просто добавляем в очередь
      console.log("message", message);

      queue.push({
        chatId: message.chat.id,
        media: [{ type: "message", messageId: message.message_id, caption: message.caption }],
      });
      sendReply(message, "✅ Сообщение добавлено в очередь.");
    }
  }, SEND_COOLDOWN);
});

startServer();
bot.launch();
bot.telegram.sendMessage(ADMIN_ID, "🤖 Бот запущен!");
