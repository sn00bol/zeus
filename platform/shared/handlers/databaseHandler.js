async function initializeDatabase(client, state, dbmanager) {
    await dbmanager.init();

    if (state.isShuttingDown) {
        await dbmanager.close();
        return false;
    }

    client.db = dbmanager;
    state.databasesReady = true;
    return true;
}

module.exports = { initializeDatabase };
