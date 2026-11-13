const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

async function loadBrowserModule(fileName) {
    const source = await readFile(path.join(__dirname, '..', 'webui', 'js', fileName), 'utf8');
    return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

test('WebUI memory identity is stable and included with chat requests', async () => {
    const originalStorage = globalThis.localStorage;
    const originalCrypto = globalThis.crypto;
    const originalFetch = globalThis.fetch;
    const storage = new Map();
    globalThis.localStorage = {
        getItem: key => storage.get(key) || null,
        setItem: (key, value) => storage.set(key, String(value)),
    };
    globalThis.crypto = {
        randomUUID: () => '8a5f8cdf-7d37-4f4f-9ea1-aaf55a179817',
    };

    try {
        const { getMemoryUserId } = await loadBrowserModule('session.js');
        const { startChatStream } = await loadBrowserModule('stream.js');
        const memoryUserId = getMemoryUserId();
        let requestBody;
        globalThis.fetch = async (_, options) => {
            requestBody = JSON.parse(options.body);
            return { ok: true, json: async () => ({ streamId: 'stream-1' }) };
        };

        assert.equal(getMemoryUserId(), memoryUserId);
        await startChatStream({
            conversationId: 'conversation-2',
            message: 'Add a feature to it',
            memoryUserId,
        });

        assert.equal(requestBody.memoryUserId, memoryUserId);
    } finally {
        if (originalStorage === undefined) delete globalThis.localStorage;
        else globalThis.localStorage = originalStorage;
        if (originalCrypto === undefined) delete globalThis.crypto;
        else globalThis.crypto = originalCrypto;
        if (originalFetch === undefined) delete globalThis.fetch;
        else globalThis.fetch = originalFetch;
    }
});
