module.exports = function (bot, queueManager) {
	bot.action(/delete_from_queue_(\d+)/, async (ctx) => {
		const messageIdToDelete = Number(ctx.match[1]);
		await queueManager.removeFromQueue(messageIdToDelete);

		try {
			await ctx.deleteMessage();
			await bot.telegram.deleteMessage(ctx.chat.id, messageIdToDelete);
		} catch (error) {
			console.error('Ошибка при удалении:', error.message);
			await ctx.answerCbQuery('Не удалось удалить сообщение');
			return;
		}

		await ctx.answerCbQuery('Сообщение удалено из очереди');
	});

	bot.action(/delete_from_queue_media_(.+)/, async (ctx) => {
		const mediaGroupId = ctx.match[1];
		const task = await queueManager.removeMediaGroupFromQueue(mediaGroupId);

		if (!task) {
			await ctx.answerCbQuery('Медиагруппа не найдена');
			return;
		}

		try {
			for (const media of task.media) {
				await bot.telegram.deleteMessage(task.chatId, media.messageId);
			}
			await ctx.deleteMessage();
		} catch (error) {
			console.error('Ошибка удаления медиагруппы:', error);
			await ctx.answerCbQuery('Ошибка при удалении');
			return;
		}

		await ctx.answerCbQuery('Медиагруппа удалена');
	});
};
