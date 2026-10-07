const http = require('node:http');

function checkHealth({
    host = process.env.HEALTHCHECK_HOST || '127.0.0.1',
    port = Number(process.env.HEALTHCHECK_PORT) || 3000,
    timeoutMs = 3_000,
} = {}) {
    return new Promise((resolve, reject) => {
        const request = http.get({ host, port, path: '/health' }, response => {
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('error', reject);
            response.on('end', () => {
                const body = Buffer.concat(chunks).toString('utf8').trim();
                if (response.statusCode !== 200 || body !== 'ready') {
                    reject(new Error(
                        `Telegram healthcheck failed (${response.statusCode || 'no status'}): ${body || 'empty response'}`,
                    ));
                    return;
                }
                resolve(body);
            });
        });

        request.setTimeout(timeoutMs, () => {
            request.destroy(new Error(`Telegram healthcheck timed out after ${timeoutMs}ms.`));
        });
        request.on('error', reject);
    });
}

if (require.main === module) {
    checkHealth().then(() => {
        console.log('Telegram healthcheck passed.');
    }).catch(error => {
        console.error(`[HEALTH] ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = { checkHealth };
