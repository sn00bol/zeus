const { createHealthcheckServer: createSharedHealthcheckServer } = require('./healthcheckServer');

function createHealthcheckServer(client, state) {
    return createSharedHealthcheckServer(
        () => state.databasesReady && client.isReady() && !state.isShuttingDown,
    );
}

module.exports = { createHealthcheckServer };
