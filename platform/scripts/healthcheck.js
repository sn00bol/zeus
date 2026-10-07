require('dotenv').config({ path: require('node:path').join(__dirname, '..', '..', '.env') });

const { checkHealth } = require('../telegram/scripts/healthcheck');

if (require.main === module) {
    checkHealth().then(() => {
        console.log('ZEUS platform healthcheck passed.');
    }).catch(error => {
        console.error(`[HEALTH] ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = { checkHealth };
