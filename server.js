const express = require('express');
const app = express();

// Позволяем парсить JSON в теле запроса
app.use(express.json());

// Подключаем созданный ранее роутер бота
const botRouter = require('./botServer');
// Все запросы, начинающиеся с /bot, будут обрабатываться модулем botServer
app.use('/bot', botRouter);

// Определяем порт для сервера (по умолчанию 3000, можно изменить через переменную окружения PORT)
const PORT = process.env.PORT || 3000;

// Функция запуска сервера
function startServer() {
	app.listen(PORT, () => {
		console.log(`Server is running on port ${PORT}`);
	});
}

// Экспортируем функцию запуска сервера
module.exports = { startServer };
