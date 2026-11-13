const assert = require('node:assert/strict');
const test = require('node:test');

const { createTitleGenerationService } = require('../webui/js/title');

test('conversation title generation has no request timeout', async () => {
    let requestOptions;
    const generateTitle = createTitleGenerationService({
        request: async (path, options) => {
            assert.equal(path, '/infer');
            requestOptions = options;
            return { content: 'A generated title' };
        },
    });

    const title = await generateTitle({
        message: 'Summarize this conversation.',
        provider: 'ollama',
        model: 'llama-test',
    });

    assert.equal(title, 'A generated title');
    assert.equal(requestOptions.timeoutMs, 0);
    assert.equal(requestOptions.body.disable_backend_timeout, true);
});

test('conversation title generation uses the database model when no chat model is selected', async () => {
    const calls = [];
    const generateTitle = createTitleGenerationService({
        request: async (path, options) => {
            calls.push({ path, options });
            if (path === '/model-configuration') {
                return { provider: 'ollama', model: 'database-model' };
            }
            return { content: 'A database-backed title' };
        },
    });

    const title = await generateTitle({ message: 'Summarize this conversation.' });

    assert.equal(title, 'A database-backed title');
    assert.deepEqual(calls.map(call => call.path), ['/model-configuration', '/infer']);
    assert.equal(calls[0].options.timeoutMs, 0);
    assert.equal(calls[1].options.body.provider, 'ollama');
    assert.equal(calls[1].options.body.model, 'database-model');
    assert.equal(calls[1].options.body.strict_model, true);
    assert.equal(calls[1].options.body.disable_backend_timeout, true);
});

test('conversation title generation leaves automatic database model resolution to inference', async () => {
    let inferenceOptions;
    const generateTitle = createTitleGenerationService({
        request: async (path, options) => {
            if (path === '/model-configuration') {
                return { provider: 'ollama', model: 'automatic' };
            }
            assert.equal(path, '/infer');
            inferenceOptions = options;
            return { content: 'An automatic-model title' };
        },
    });

    await generateTitle({ message: 'Summarize this conversation.' });

    assert.equal(inferenceOptions.body.provider, undefined);
    assert.equal(inferenceOptions.body.model, undefined);
    assert.equal(inferenceOptions.body.strict_model, false);
});
