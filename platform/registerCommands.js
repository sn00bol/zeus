require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });

const database = require('../core/database');

async function registerSelectedPlatformCommands({
    reset = process.argv.includes('--reset'),
} = {}) {
    await database.init();
    const settings = await database.getPlatformSettings();
    const results = {};
    if (settings.discord) {
        const { runSlashRegister } = require('./discord/CommandHandler');
        results.discord = await runSlashRegister({ reset });
    }
    if (settings.telegram) {
        const { runCommandRegister } = require('./telegram/CommandHandler');
        results.telegram = await runCommandRegister({ force: reset });
    }
    if (!Object.keys(results).length) {
        console.log('[COMMANDS] No bot platforms are enabled in the database.');
    }
    return results;
}

if (require.main === module) {
    registerSelectedPlatformCommands().catch(error => {
        console.error('[COMMANDS] Registration failed:', error);
        process.exitCode = 1;
    });
}

module.exports = { registerSelectedPlatformCommands };
