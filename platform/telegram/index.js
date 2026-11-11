require('dotenv').config();
const dbmanager = require('../../core/database');
const { createTelegramClient } = require('./gateway');
const {
    connectData,
    loadCommands,
    registerCommandHandlers,
    registerShutdownHandlers,
    synchronizeTelegramCommands,
} = require('./CommandHandler');
const { createHealthcheckServer } = require('./healthcheckHandler');

const bot = createTelegramClient();
const state = {
    databasesReady: false,
    botReady: false,
    isShuttingDown: false,
    presenceInterval: null,
    shutdownPromise: null,
};
const activeCommands = new Set();
const healthServer = createHealthcheckServer(bot, state);

loadCommands(bot);
registerCommandHandlers(bot, state, activeCommands);
const shutdown = registerShutdownHandlers({
    bot,
    state,
    healthServer,
    activeCommands,
    dbmanager,
});

connectData(bot, state, dbmanager).then(async () => {
    if (!state.isShuttingDown) {
        await synchronizeTelegramCommands(bot.telegram, bot.commands);
        bot.launch({}, () => {
            state.botReady = true;
            console.log(`[LOGIN] Telegram bot @${bot.botInfo.username} authenticated.`);
        }).catch(error => {
            state.botReady = false;
            console.error('[LOGIN] Telegram polling failed:', error);
            process.exitCode = 1;
            shutdown('Telegram polling failed').catch(shutdownError => {
                console.error('[SHUTDOWN] Failed after Telegram polling error:', shutdownError);
                process.exitCode = 1;
            });
        });
    }
}).catch(error => {
    console.error('[STARTUP] Telegram bot initialization failed:', error);
    process.exitCode = 1;
    shutdown('Telegram initialization failed').catch(shutdownError => {
        console.error('[SHUTDOWN] Failed after Telegram initialization error:', shutdownError);
        process.exitCode = 1;
    });
});
