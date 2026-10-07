const { initializeDatabase } = require('../../shared/handlers/databaseHandler');
const { retryWithBackoff } = require('../utils/retry');

async function connectData(client, state, db) {
    try {
        if (!await initializeDatabase(client, state, db)) return;

        await retryWithBackoff(async () => {
            const token = process.env.DISCORD_BOT_API_KEY;
            if (!token) {
                throw new Error('DISCORD_BOT_API_KEY is missing in .env file');
            }
            return await client.login(token);
        }, {
            initialDelayMs: 5000,
            maxDelayMs: 60000,
            shouldRetry: (error) => {
                if (state.isShuttingDown) return false;
                if (error.code === 'TokenInvalid' || error.code === 'TokenMissing' || error.status === 401) {
                    console.error('[LOGIN] Critical error: Invalid token. Please check your .env file.');
                    return false;
                }
                return true;
            },
            onRetry: (error, attempt, delayMs) => {
                console.error(`[LOGIN] Discord connection attempt ${attempt} failed: ${error.message}`);
                console.warn(`[LOGIN] Retrying in ${Math.ceil(delayMs / 1000)} seconds.`);
            },
        });
    } catch (error) {
        if (state.isShuttingDown) return;
        console.error('Error initializing bot:', error);
        process.exit(1);
    }
}

module.exports = { connectData };
