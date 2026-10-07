function registerShutdownHandlers({ client, state, healthServer, activeCommands, dbmanager }) {
    async function shutdown(signal) {
        if (state.shutdownPromise) return state.shutdownPromise;
        state.isShuttingDown = true;
        state.databasesReady = false;
        console.log(`[SHUTDOWN] Received ${signal}; closing bot resources.`);

        if (state.presenceInterval) clearInterval(state.presenceInterval);

        state.shutdownPromise = (async () => {
            const pendingCommands = Promise.allSettled([...activeCommands]);
            const healthServerClosed = healthServer && healthServer.listening
                ? new Promise(resolve => healthServer.close(resolve))
                : Promise.resolve();
            const commandResults = await Promise.allSettled([
                pendingCommands,
                healthServerClosed,
            ]);
            client.destroy();
            const databaseResults = await Promise.allSettled([dbmanager.close()]);
            const failures = [...commandResults, ...databaseResults]
                .filter(result => result.status === 'rejected');
            if (failures.length > 0) {
                failures.forEach(result => console.error('[SHUTDOWN] Resource close failed:', result.reason));
                process.exitCode = 1;
            }
        })();

        return state.shutdownPromise;
    }

    for (const signal of ['SIGINT', 'SIGTERM']) {
        process.once(signal, () => {
            shutdown(signal).catch(error => {
                console.error('[SHUTDOWN] Failed to stop cleanly:', error);
                process.exitCode = 1;
            });
        });
    }
}

module.exports = { registerShutdownHandlers };
