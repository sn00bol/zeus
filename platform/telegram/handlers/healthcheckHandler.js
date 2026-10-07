const { createHealthcheckServer: createSharedHealthcheckServer } = require('../../shared/handlers/healthcheckServer');

function createHealthcheckServer(_bot, state) {
    return createSharedHealthcheckServer(
        () => state.databasesReady && state.botReady && !state.isShuttingDown,
    );
}

module.exports = { createHealthcheckServer };
