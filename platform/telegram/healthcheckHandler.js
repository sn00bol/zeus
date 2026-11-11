const { createHealthcheckServer: createSharedHealthcheckServer } = require('./healthcheckServer');

function createHealthcheckServer(_bot, state) {
    return createSharedHealthcheckServer(
        () => state.databasesReady && state.botReady && !state.isShuttingDown,
    );
}

module.exports = { createHealthcheckServer };
