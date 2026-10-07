require('dotenv').config({ path: require('node:path').join(__dirname, '..', '..', '.env') });

const { resolvePlatform } = require('../shared/platformSelection');

async function registerSelectedPlatformCommands({
    platform = resolvePlatform(),
    reset = process.argv.includes('--reset'),
} = {}) {
    const selected = resolvePlatform(platform);
    if (selected === 'discord') {
        const { runSlashRegister } = require('../discord/scripts/slashRegister');
        return runSlashRegister({ reset });
    }

    const { runCommandRegister } = require('../telegram/scripts/registerCommands');
    return runCommandRegister({ force: reset });
}

if (require.main === module) {
    registerSelectedPlatformCommands().catch(error => {
        console.error('[COMMANDS] Registration failed:', error);
        process.exitCode = 1;
    });
}

module.exports = { registerSelectedPlatformCommands };
