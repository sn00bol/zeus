const { Telegraf } = require('telegraf');

function createTelegramClient() {
    const token = process.env.TELEGRAM_BOT_API_KEY;
    if (!token) {
        throw new Error('TELEGRAM_BOT_API_KEY is not defined in environment variables');
    }

    const bot = new Telegraf(token);

    return bot;
}

module.exports = { createTelegramClient };
