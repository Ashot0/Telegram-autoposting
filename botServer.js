// botServer.js
const express = require('express');
const router = express.Router();

// Пример обработки GET-запроса по пути / (полный маршрут будет /bot/)
router.get('/', (req, res) => {
	res.send('Bot router работает');
});

module.exports = router;
