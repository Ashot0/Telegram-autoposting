const { Telegraf } = require("telegraf");
const { Markup } = require("telegraf");
const { CHANNEL_ID, ADMIN_ID, BOT_TOKEN } = require("./config");

const bot = new Telegraf(BOT_TOKEN);

let adminLogMessages = [];

// Функция для отправки обычного сообщения (копирование)
async function sendMessage(
  chatId,
  messageId,
  caption,
  caption_entities,
  show_caption_above_media,
  has_media_spoiler
) {
  try {
    await bot.telegram.copyMessage(CHANNEL_ID, chatId, messageId, {
      caption,
      caption_entities,
      show_caption_above_media,
      has_media_spoiler,
    });
  } catch (error) {
    throw new Error(`[ERROR] Ошибка при отправке сообщения: ${error.message}`);
  }
}

// Функция для отправки медиагруппы
async function sendMediaGroup(media) {
  if (!media || media.length === 0) {
    throw new Error("[ERROR] Медиагруппа пуста");
  }
  try {
    await bot.telegram.sendMediaGroup(CHANNEL_ID, media);
  } catch (error) {
    throw new Error(
      `[ERROR] Ошибка при отправке медиагруппы: ${error.message}`
    );
  }
}

// Функция для отправки текстового ответа
async function sendReply(message, text, options = {}) {
  try {
    const reply = await bot.telegram.sendMessage(
      message.chat?.id || message,
      text,
      options
    );
    if (message.chat?.id === ADMIN_ID || message === ADMIN_ID) {
      adminLogMessages.push(reply.message_id);
    }
    
  } catch (error) {
    console.error("[ERROR] Ошибка при отправке ответа:", error.message);
  }
}

async function sendReply(message, text, options = {}) {
  try {
    const reply = await bot.telegram.sendMessage(
      message.chat?.id || message,
      text,
      options
    );
    if (message.chat?.id === ADMIN_ID || message === ADMIN_ID) {
      adminLogMessages.push(reply.message_id);
    }
    return reply; // Возвращаем отправленное сообщение
  } catch (error) {
    console.error("[ERROR] Ошибка при отправке ответа:", error.message);
  }
}

// Функция для отправки ответа с inline-кнопкой (для удаления)
async function sendReplyWithDeleteButton(message, text) {
  try {
    const inlineKeyboard = Markup.inlineKeyboard([
      Markup.button.callback(
        "Удалить из очереди",
        `delete_from_queue_${message.message_id}`
      ),
    ]);

    const reply = await bot.telegram.sendMessage(
      message.chat?.id || message,
      text,
      { reply_markup: inlineKeyboard.reply_markup }
    );

    if (message.chat?.id === ADMIN_ID || message === ADMIN_ID) {
      adminLogMessages.push(reply.message_id);
    }
  } catch (error) {
    console.error(
      "[ERROR] Ошибка при отправке ответа с inline-кнопкой:",
      error.message
    );
  }
}

// Геттер для сохраненных ID лог-сообщений администратора
function getAdminLogMessages() {
  return adminLogMessages;
}

// Функция очистки лог-сообщений
function clearAdminLogMessages() {
  adminLogMessages.length = 0;
}

module.exports = {
  sendMessage,
  sendMediaGroup,
  sendReply,
  sendReplyWithDeleteButton,
  getAdminLogMessages,
  clearAdminLogMessages,
};
