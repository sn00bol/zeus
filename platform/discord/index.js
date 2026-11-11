// RUNNING BOT: npm run start (for regular use) or npm run dev (with nodemon for auto-restart on changes)

require('dotenv').config();
const dbmanager = require('../../core/database');
const { createDiscordClient } = require('./gateway');
const {
    connectData,
    registerCommandHandlers,
    registerShutdownHandlers,
    startPresence,
} = require('./CommandHandler');
const { createHealthcheckServer } = require('./healthcheckHandler');

const client = createDiscordClient();
const state = {
    databasesReady: false,
    isShuttingDown: false,
    presenceInterval: null,
    shutdownPromise: null,
};
const activeCommands = new Set();
const healthServer = createHealthcheckServer(client, state);

registerCommandHandlers(client, state, activeCommands);
registerShutdownHandlers({
    client,
    state,
    healthServer,
    activeCommands,
    dbmanager,
});

connectData(client, state, dbmanager).then(() => {
    if (!state.isShuttingDown) {
        state.presenceInterval = startPresence(client);
    }
});
