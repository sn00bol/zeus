const http = require('node:http');

function createHealthcheckServer(isReady) {
    if (process.env.ENABLE_DOCKER_HEALTHCHECK !== 'true') return null;

    const server = http.createServer((request, response) => {
        if (request.method !== 'GET' || request.url !== '/health') {
            response.writeHead(404).end();
            return;
        }

        const ready = isReady();
        response.writeHead(ready ? 200 : 503, {
            'Content-Type': 'text/plain; charset=utf-8',
        });
        response.end(ready ? 'ready' : 'not ready');
    }).listen(
        Number(process.env.HEALTHCHECK_PORT) || 3000,
        process.env.HEALTHCHECK_HOST || '127.0.0.1',
    );

    server.on('error', error => {
        console.error('[HEALTH] Healthcheck server failed:', error);
    });

    return server;
}

module.exports = { createHealthcheckServer };
