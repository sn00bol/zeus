const { initializeDatabase } = require('../../shared/handlers/databaseHandler');

async function connectData(bot, state, db) {
    try {
        await initializeDatabase(bot, state, db);
    } catch (error) {
        if (state.isShuttingDown) return;
        console.error('Error initializing Telegram bot:', error);
        process.exit(1);
    }
}

module.exports = { connectData };
