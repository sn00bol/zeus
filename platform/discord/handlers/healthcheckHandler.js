const { createHealthcheckServer: createSharedHealthcheckServer } = require('../../shared/handlers/healthcheckServer');

function createHealthcheckServer(client, state) {
    return createSharedHealthcheckServer(
        () => state.databasesReady && client.isReady() && !state.isShuttingDown,
    );
}

module.exports = { createHealthcheckServer };
