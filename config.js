const dotenv = require('dotenv');
dotenv.config();

module.exports = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  CHANNEL_ID: process.env.CHANNEL_ID,
  ADMIN_ID: Number(process.env.ADMIN_ID),
  SEND_TIMER: process.env.SEND_TIMER || "0 * * * *",
  SEND_COOLDOWN: process.env.SEND_COOLDOWN || 600000,
  TIME_ZONE: Number(process.env.TIME_ZONE) || +2,
  PORT: process.env.PORT || 10000,
};
