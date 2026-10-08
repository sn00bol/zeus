const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const { checkHealth } = require('../platform/scripts/healthcheck');

async function withHealthServers(count, callback) {
    const servers = Array.from({ length: count }, () => http.createServer((request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/plain' });
        response.end('ready');
    }));
    const ports = [];
    try {
        for (const server of servers) {
            await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
            ports.push(server.address().port);
        }
        await callback(ports);
    } finally {
        await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
    }
}

test('healthcheck verifies only WebUI when no bot platform is selected', async () => {
    await withHealthServers(1, async ([webuiPort]) => {
        const previous = {
            platform: process.env.PLATFORM,
            webuiPort: process.env.WEBUI_PORT,
        };
        process.env.PLATFORM = 'webui';
        process.env.WEBUI_PORT = String(webuiPort);
        try {
            assert.deepEqual(await checkHealth(), ['ready']);
        } finally {
            if (previous.platform === undefined) delete process.env.PLATFORM;
            else process.env.PLATFORM = previous.platform;
            if (previous.webuiPort === undefined) delete process.env.WEBUI_PORT;
            else process.env.WEBUI_PORT = previous.webuiPort;
        }
    });
});

test('healthcheck verifies WebUI and the selected bot', async () => {
    await withHealthServers(2, async ([webuiPort, botPort]) => {
        const previous = {
            platform: process.env.PLATFORM,
            webuiPort: process.env.WEBUI_PORT,
            healthcheckPort: process.env.HEALTHCHECK_PORT,
        };
        process.env.PLATFORM = 'webui,discord';
        process.env.WEBUI_PORT = String(webuiPort);
        process.env.HEALTHCHECK_PORT = String(botPort);
        try {
            assert.deepEqual(await checkHealth(), ['ready', 'ready']);
        } finally {
            if (previous.platform === undefined) delete process.env.PLATFORM;
            else process.env.PLATFORM = previous.platform;
            if (previous.webuiPort === undefined) delete process.env.WEBUI_PORT;
            else process.env.WEBUI_PORT = previous.webuiPort;
            if (previous.healthcheckPort === undefined) delete process.env.HEALTHCHECK_PORT;
            else process.env.HEALTHCHECK_PORT = previous.healthcheckPort;
        }
    });
});
