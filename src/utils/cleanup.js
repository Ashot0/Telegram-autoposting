function setupCleanup(schedule, bot, adminId, getLogs, clearLogs) {
	schedule.scheduleJob('0 3 * * *', async () => {
		console.log('[CLEAN] Запуск очистки логов');
		const logs = getLogs();
		for (const msgId of logs) {
			try {
				await bot.telegram.deleteMessage(adminId, msgId);
			} catch (error) {
				console.error(`Ошибка удаления ${msgId}: ${error.message}`);
			}
		}
		clearLogs();
	});
}

module.exports = { setupCleanup };
