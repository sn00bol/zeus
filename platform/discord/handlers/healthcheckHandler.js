const http = require('http');

function createHealthcheckServer(client, state) {
    if (process.env.ENABLE_DOCKER_HEALTHCHECK !== 'true') return null;

    const server = http.createServer((request, response) => {
        if (request.method !== 'GET' || request.url !== '/health') {
            response.writeHead(404).end();
            return;
        }

        const isReady = state.databasesReady && client.isReady() && !state.isShuttingDown;
        response.writeHead(isReady ? 200 : 503, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end(isReady ? 'ready' : 'not ready');
    }).listen(Number(process.env.HEALTHCHECK_PORT) || 3000, '127.0.0.1');

    server.on('error', error => {
        console.error('[HEALTH] Healthcheck server failed:', error);
    });

    return server;
}

module.exports = { createHealthcheckServer };
