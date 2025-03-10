const mongoose = require('mongoose');
const { MONGODB_URI } = require('./config');

async function connect() {
	try {
		await mongoose.connect(MONGODB_URI, {
			useNewUrlParser: true,
			useUnifiedTopology: true,
		});
		console.log('Connected to MongoDB');
	} catch (error) {
		console.error('MongoDB connection error:', error);
		process.exit(1);
	}
}

module.exports = { connect };
