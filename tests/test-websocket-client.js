const assert = require('node:assert/strict');
const { once } = require('node:events');
const test = require('node:test');
const { WebSocketServer } = require('ws');

const { BridgeWebSocketClient } = require('../core/websocket');

async function createServer(onMessage) {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await once(server, 'listening');
    server.on('connection', (socket, request) => onMessage(socket, request));
    const { port } = server.address();
    return {
        server,
        endpoint: `http://127.0.0.1:${port}`,
    };
}

test('bridge client correlates JSON RPC responses and supplies auth headers', async t => {
    const { server, endpoint } = await createServer((socket, request) => {
        assert.equal(request.headers.authorization, 'Bearer test-token');
        socket.on('message', raw => {
            const frame = JSON.parse(raw.toString());
            socket.send(JSON.stringify({
                id: frame.id,
                type: 'response',
                status: 200,
                body: JSON.stringify({ method: frame.method, path: frame.path }),
            }));
        });
    });
    const client = new BridgeWebSocketClient({
        endpoint,
        headers: { Authorization: 'Bearer test-token' },
    });
    t.after(() => {
        client.close();
        server.close();
    });

    assert.deepEqual(await client.request('/models?scope=webui'), {
        method: 'GET',
        path: '/models?scope=webui',
    });
});

test('bridge client yields correlated streaming frames', async t => {
    const { server, endpoint } = await createServer(socket => {
        socket.on('message', raw => {
            const frame = JSON.parse(raw.toString());
            socket.send(JSON.stringify({ id: frame.id, type: 'stream_start', status: 200 }));
            socket.send(JSON.stringify({ id: frame.id, type: 'stream_chunk', body: 'data: one\n\n' }));
            socket.send(JSON.stringify({ id: frame.id, type: 'stream_end' }));
        });
    });
    const client = new BridgeWebSocketClient({ endpoint });
    t.after(() => {
        client.close();
        server.close();
    });

    const chunks = [];
    await client.requestStream('/infer', { onChunk: chunk => chunks.push(chunk) });
    assert.deepEqual(chunks, ['data: one\n\n']);
});

test('bridge client reports remote HTTP errors', async t => {
    const { server, endpoint } = await createServer(socket => {
        socket.on('message', raw => {
            const frame = JSON.parse(raw.toString());
            socket.send(JSON.stringify({
                id: frame.id,
                type: 'response',
                status: 503,
                body: JSON.stringify({ error: 'provider unavailable' }),
            }));
        });
    });
    const client = new BridgeWebSocketClient({ endpoint });
    t.after(() => {
        client.close();
        server.close();
    });

    await assert.rejects(client.request('/models'), /provider unavailable/);
});

test('WebUI bridge parses SSE events delivered in split WebSocket chunks', async t => {
    const { server, endpoint } = await createServer(socket => {
        socket.on('message', raw => {
            const frame = JSON.parse(raw.toString());
            socket.send(JSON.stringify({ id: frame.id, type: 'stream_start', status: 200 }));
            socket.send(JSON.stringify({
                id: frame.id,
                type: 'stream_chunk',
                body: 'event: delta\ndata: {"text":',
            }));
            socket.send(JSON.stringify({
                id: frame.id,
                type: 'stream_chunk',
                body: '"hello"}\n\nevent: done\ndata: {"content":"hello"}\n\n',
            }));
            socket.send(JSON.stringify({ id: frame.id, type: 'stream_end' }));
        });
    });
    process.env.WEBUI_BRIDGE_URL = endpoint;
    delete require.cache[require.resolve('../webui/bridge')];
    const webuiBridge = require('../webui/bridge');
    t.after(() => {
        webuiBridge.close();
        server.close();
        delete process.env.WEBUI_BRIDGE_URL;
        delete require.cache[require.resolve('../webui/bridge')];
    });

    const events = [];
    const result = await webuiBridge.requestSse('/infer', {
        onEvent: (type, data) => events.push({ type, data }),
    });
    assert.deepEqual(result, { content: 'hello' });
    assert.deepEqual(events, [
        { type: 'delta', data: { text: 'hello' } },
        { type: 'done', data: { content: 'hello' } },
    ]);
});
