require('dotenv').config();
const dbmanager = require('../shared/database/dbmanager');
const { createTelegramClient } = require('./handlers/clientHandler');
const { registerCommandHandlers, loadCommands } = require('./handlers/commandHandler');
const { connectData } = require('./handlers/databaseHandler');
const { createHealthcheckServer } = require('./handlers/healthcheckHandler');
const { registerShutdownHandlers } = require('./handlers/lifecycleHandler');

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

connectData(bot, state, dbmanager).then(() => {
    if (!state.isShuttingDown) {
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
});
