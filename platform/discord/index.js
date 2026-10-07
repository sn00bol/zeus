// RUNNING BOT: npm run start (for regular use) or npm run dev (with nodemon for auto-restart on changes)

require('dotenv').config();
const dbmanager = require('../shared/database/dbmanager');
const { createDiscordClient } = require('./handlers/clientHandler');
const { registerCommandHandlers } = require('./handlers/commandHandler');
const { connectData } = require('./handlers/databaseHandler');
const { createHealthcheckServer } = require('./handlers/healthcheckHandler');
const { registerShutdownHandlers } = require('./handlers/lifecycleHandler');
const { startPresence } = require('./handlers/presenceHandler');

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
