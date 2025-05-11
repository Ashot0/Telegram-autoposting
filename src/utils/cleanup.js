const {
	getAdminLogMessages,
	clearAdminLogMessages,
} = require('../services/adminLogService');

function setupCleanup(schedule, bot, adminId) {
	schedule.scheduleJob('30 3 * * *', async () => {
		console.log('[CLEAN] Запуск очистки логов');

		// Получаем логи из MongoDB
		const logs = await getAdminLogMessages();

		// Удаляем каждое сообщение
		for (const msgId of logs) {
			try {
				await bot.telegram.deleteMessage(adminId, msgId);
				console.log(`[CLEAN] Сообщение ${msgId} удалено`);
			} catch (error) {
				console.error(`Ошибка удаления ${msgId}: ${error.message}`);
			}
		}

		// Очищаем логи в MongoDB
		await clearAdminLogMessages();
		console.log('[CLEAN] Логи очищены в базе данных');
	});
}

module.exports = { setupCleanup };
