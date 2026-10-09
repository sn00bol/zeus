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
    const request = path => new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port, path }, response => {
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => resolve({
                status: response.statusCode,
                body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
            }));
        }).on('error', reject);
    });
    const requestRaw = path => new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port, path }, response => {
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => resolve({
                status: response.statusCode,
                headers: response.headers,
                body: Buffer.concat(chunks),
            }));
        }).on('error', reject);
    });

    try {
        const page = await requestRaw('/');
        assert.equal(page.status, 200);
        assert.match(page.body.toString('utf8'), /<link rel="icon" href="\/zeus\.ico"/);

        const icon = await requestRaw('/zeus.ico');
        assert.equal(icon.status, 200);
        assert.equal(icon.headers['content-type'], 'image/x-icon');
        assert.deepEqual([...icon.body.subarray(0, 4)], [0, 0, 1, 0]);

        const status = await request('/api/status');
        assert.equal(status.status, 200);
        assert.deepEqual(requests, ['/models', '/status']);

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
