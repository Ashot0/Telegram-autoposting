const express = require('express');
const { PORT } = require("./config");
const botRouter = require("./botServer");

const app = express();

app.use(express.json());
app.use('/bot', botRouter);


function startServer() {
	app.listen(PORT, () => {
		console.log(`[START] Server is running on port ${PORT}`);
	});
}

module.exports = { startServer };