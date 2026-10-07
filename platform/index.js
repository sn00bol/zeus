require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });

const { getPlatformEntry } = require('./shared/platformSelection');

try {
    require(getPlatformEntry());
} catch (error) {
    console.error(`[PLATFORM] Failed to start selected platform: ${error.message}`);
    process.exitCode = 1;
}
