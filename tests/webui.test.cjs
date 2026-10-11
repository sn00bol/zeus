const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { createWebUiServer } = require('../webui/app');
const { StreamManager } = require('../webui/streamManager');

test('WebUI uses its bridge and supports reconnecting to a server-side stream', async () => {
    const requests = [];
    const streamManager = new StreamManager();
    let releaseStream;
    const server = createWebUiServer({
        db: {},
        bridgeRequest: async route => {
            requests.push(route);
            if (route === '/models') return { models: [] };
            return { model: 'local-model' };
        },
        streamManager,
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const request = (path, targetPort = port) => new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port: targetPort, path }, response => {
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => resolve({
                status: response.statusCode,
                body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
            }));
        }).on('error', reject);
    });
    const requestRaw = (path, targetPort = port) => new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port: targetPort, path }, response => {
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => resolve({
                status: response.statusCode,
                headers: response.headers,
                body: Buffer.concat(chunks),
            }));
        }).on('error', reject);
    });
    const post = (path, payload) => new Promise((resolve, reject) => {
        const body = JSON.stringify(payload);
        const outgoing = http.request({
            host: '127.0.0.1',
            port,
            path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
            },
        }, response => {
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => resolve({
                status: response.statusCode,
                body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
            }));
        });
        outgoing.on('error', reject);
        outgoing.end(body);
    });

    try {
        const page = await requestRaw('/');
        assert.equal(page.status, 200);
        assert.match(page.body.toString('utf8'), /<link rel="icon" href="\/zeus\.ico"/);
        assert.match(page.body.toString('utf8'), /<meta name="zeus-boot-id" content="[a-f0-9-]{36}">/);
        assert.match(page.body.toString('utf8'), /src="\/ZEUSbanner\.png"/);
        const currentBootId = page.body.toString('utf8').match(
            /<meta name="zeus-boot-id" content="([^"]+)">/,
        )[1];

        const theme = await requestRaw('/js/theme.js');
        assert.equal(theme.status, 200);
        assert.match(theme.body.toString('utf8'), /--accent:\s*#fb923c/);
        assert.match(theme.body.toString('utf8'), /background:\s*#100d0b/);
        assert.doesNotMatch(theme.body.toString('utf8'), /#a78bfa|#c4b5fd/);

        const banner = await requestRaw('/ZEUSbanner.png');
        assert.equal(banner.status, 200);
        assert.equal(banner.headers['content-type'], 'image/png');
        assert.deepEqual([...banner.body.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);

        const restartedServer = createWebUiServer({
            db: {},
            bridgeRequest: async () => ({}),
        });
        await new Promise(resolve => restartedServer.listen(0, '127.0.0.1', resolve));
        try {
            const restartedPort = restartedServer.address().port;
            const restartedPage = await requestRaw('/', restartedPort);
            const restartedBootId = restartedPage.body.toString('utf8').match(
                /<meta name="zeus-boot-id" content="([^"]+)">/,
            )[1];
            assert.notEqual(restartedBootId, currentBootId);
        } finally {
            await new Promise((resolve, reject) => restartedServer.close(error => (
                error ? reject(error) : resolve()
            )));
        }

        const icon = await requestRaw('/zeus.ico');
        assert.equal(icon.status, 200);
        assert.equal(icon.headers['content-type'], 'image/x-icon');
        assert.deepEqual([...icon.body.subarray(0, 4)], [0, 0, 1, 0]);

        const status = await request('/api/status');
        assert.equal(status.status, 200);
        assert.deepEqual(requests, ['/models', '/status']);

        const tools = await request('/api/tools');
        assert.equal(tools.status, 200);
        assert.deepEqual(tools.body.tools, [{
            name: 'search',
            label: 'Search',
            description: 'Search the web for current facts, recent news, quick lookups, and online comparisons',
        }]);
        const unknownTool = await post('/api/chat', {
            conversationId: 'conversation-1',
            message: 'Search for this',
            tools: ['browser'],
        });
        assert.equal(unknownTool.status, 400);
        const duplicateTool = await post('/api/chat', {
            conversationId: 'conversation-1',
            message: 'Search for this',
            tools: ['search', 'search'],
        });
        assert.equal(duplicateTool.status, 400);

        const streamId = streamManager.start(
            async () => new Promise(resolve => { releaseStream = resolve; }),
            'conversation-1',
        );
        const active = await request('/api/streams/active?conversationId=conversation-1');
        assert.equal(active.status, 200);
        assert.equal(active.body.streamId, streamId);

        releaseStream();
        await streamManager.streams.get(streamId).task;
        const completed = await request('/api/streams/active?conversationId=conversation-1');
        assert.equal(completed.body.streamId, null);
    } finally {
        if (releaseStream) releaseStream();
        await new Promise((resolve, reject) => server.close(error => (
            error ? reject(error) : resolve()
        )));
    }
});
