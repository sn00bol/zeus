const http = require('node:http');
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '..', '.env') });

function checkEndpoint(port, expectedBody = 'ready') {
    return new Promise((resolve, reject) => {
        const request = http.get({
            host: process.env.HEALTHCHECK_HOST || '127.0.0.1',
            port,
            path: '/health',
        }, response => {
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('error', reject);
            response.on('end', () => {
                const body = Buffer.concat(chunks).toString('utf8').trim();
                if (response.statusCode !== 200 || body !== expectedBody) {
                    reject(new Error(
                        `Healthcheck failed on port ${port} (${response.statusCode || 'no status'}): ${body || 'empty response'}`,
                    ));
                    return;
                }
                resolve(body);
            });
        });
        request.setTimeout(3_000, () => {
            request.destroy(new Error(`Healthcheck timed out on port ${port}.`));
        });
        request.on('error', reject);
    });
}

function checkHealth() {
    const selected = (process.env.PLATFORM || 'webui')
        .split(',')
        .map(platform => platform.trim().toLowerCase())
        .filter(Boolean);
    if (!selected.includes('webui')) selected.unshift('webui');
    const webuiPort = Number(process.env.WEBUI_PORT) || 3000;
    const checks = [
        checkEndpoint(webuiPort),
    ];
    const bots = ['discord', 'telegram'].filter(platform => selected.includes(platform));
    let healthcheckPort = Number(process.env.HEALTHCHECK_PORT) || 3001;
    for (let index = 0; index < bots.length; index += 1) {
        if (healthcheckPort === webuiPort) healthcheckPort += 1;
        checks.push(checkEndpoint(healthcheckPort));
        healthcheckPort += 1;
    }
    return Promise.all(checks);
}

if (require.main === module) {
    checkHealth().then(() => {
        console.log('ZEUS platform healthcheck passed.');
    }).catch(error => {
        console.error(`[HEALTH] ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = { checkHealth, checkEndpoint };
