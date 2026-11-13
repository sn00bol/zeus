const assert = require('node:assert/strict');
const { once } = require('node:events');
const test = require('node:test');

const { createWebUiServer } = require('../webui/app');

test('model preference reuses the recently loaded model list', async t => {
    let modelListRequests = 0;
    let savedPreference;
    const server = createWebUiServer({
        db: {
            getModelPreference: async () => null,
            setModelPreference: async (scope, provider, model) => {
                savedPreference = { scope, provider, model };
            },
        },
        bridgeRequest: async route => {
            if (route === '/models') {
                modelListRequests += 1;
                return { models: [{ provider: 'ollama', model: 'qwen-test' }] };
            }
            if (route === '/status') return { model: { model: 'qwen-test' } };
            throw new Error(`Unexpected bridge route: ${route}`);
        },
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise(resolve => server.close(resolve)));

    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const modelsResponse = await fetch(`${baseUrl}/api/models?conversationId=conversation-1`);
    assert.equal(modelsResponse.status, 200);
    assert.equal(modelListRequests, 1);

    const preferenceResponse = await fetch(`${baseUrl}/api/model-preference`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            conversationId: 'conversation-1',
            provider: 'ollama',
            model: 'qwen-test',
        }),
    });

    assert.equal(preferenceResponse.status, 200);
    assert.equal(modelListRequests, 1);
    assert.deepEqual(savedPreference, {
        scope: 'webui:conversation:conversation-1',
        provider: 'ollama',
        model: 'qwen-test',
    });
});
