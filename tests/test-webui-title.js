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
