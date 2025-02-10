# Telegram Media Scheduler Bot

This Telegram bot allows administrators to send media messages directly to a Telegram channel. The bot automatically processes media received in private messages, schedules them for posting, and deletes the original message after posting to the channel. There is a 10-minute delay before adding a media message to the queue to allow for editing, and the bot sends posts every hour.

## Features

- Automatically processes media messages received in private messages.
- Supports various media types:
  - Photos
  - Videos
  - GIFs
  - Stickers
  - Audio
  - Documents
  - Video notes
  - Voice messages
- A 10-minute delay is applied before adding media to the queue, giving users time to edit the messages.
- Posts are sent to the channel every hour.
- Deletes the original message after posting to the channel.
- Includes a server for monitoring the bot’s status and operation.

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/telegram-media-scheduler-bot.git
   ```

2. Navigate to the project directory:
   ```bash
   cd telegram-media-scheduler-bot
   ```

3. Install the dependencies:
   ```bash
   npm install
   ```

4. Create a `config.js` file in the root of the project and add your bot’s settings:
   ```js
   module.exports = {
     BOT_TOKEN: 'YOUR_BOT_TOKEN',
     CHANNEL_ID: 'YOUR_CHANNEL_ID',
     ADMIN_ID: 'YOUR_ADMIN_ID',
     SERVER_PORT: 3000, // You can adjust the port if needed
   };
   ```

   Replace `YOUR_BOT_TOKEN`, `YOUR_CHANNEL_ID`, and `YOUR_ADMIN_ID` with actual values.

5. Start the bot and the server:
   ```bash
   npm start
   ```

6. The bot will start processing messages sent to it and automatically post them to the specified channel every hour. The server will be running to monitor the bot’s status.

## Monitoring the Bot

The bot includes a simple monitoring server to track its operation. By default, it runs on port `3000`. You can access the server’s status by visiting:
```
http://localhost:3000/bot/
```

This will show you if the bot is running and whether it has encountered any issues.

## How It Works

- **Sending Media**: To send media, simply send the media (photo, video, audio, etc.) directly to the bot in a private message. The bot will automatically process and queue it for posting to the channel.
- **Editing Messages**: You have a 10-minute window to edit your media message. After 10 minutes, the bot will add it to the queue.
- **Sending Posts**: The bot will send posts to the channel every hour. If multiple items are in the queue, they will be sent one by one.
- **Message Deletion**: After successfully sending the media to the channel, the bot will delete the original message from the private chat to keep it clean.

## Notes

- The bot does not require any commands. It processes all media sent to it in private messages.
- The 10-minute delay gives you time to edit or change the media message before it is added to the queue.
- Posts will be sent every hour. The bot will continue to post even if no new media is added to the queue.
- If there are issues with sending a post, the bot will attempt to resend it during the next scheduled post.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
