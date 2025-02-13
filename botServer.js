const express = require('express');
const router = express.Router();


router.get('/', (req, res) => {
	res.send('Bot router работает');
});

router.post("/", (req, res) => {
  console.log("Получено обновление:", req.body);
  res.sendStatus(200); 
});

router.use((err, req, res, next) => {
	console.error(err.stack);
	res.status(500).send('Ошибка сервера');
});

module.exports = router;