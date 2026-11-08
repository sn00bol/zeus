const assert = require('node:assert/strict');
const test = require('node:test');
const { createTitleGenerationService, normalizeGeneratedTitle } = require('../webui/js/title');

test('generated titles preserve complete meaningful output without hard truncation', () => {
    assert.equal(
        normalizeGeneratedTitle('Title: How to optimize a slow PostgreSQL query. Here are several steps.'),
        'How to optimize a slow PostgreSQL query. Here are several steps.',
    );
    assert.equal(
        normalizeGeneratedTitle('```text\nTối ưu truy vấn PostgreSQL cho dữ liệu lớn\n```'),
        'Tối ưu truy vấn PostgreSQL cho dữ liệu lớn',
    );
});

test('generated titles keep their full first line and discard extra lines', () => {
    assert.equal(
        normalizeGeneratedTitle('Improve PostgreSQL query performance for large datasets.\nDetails: ...'),
        'Improve PostgreSQL query performance for large datasets.',
    );
});

test('title generation allows enough output for a complete title', async () => {
    let requestOptions;
    const generateTitle = createTitleGenerationService({
        request: async (_route, options) => {
            requestOptions = options;
            return { content: 'Optimize PostgreSQL query performance' };
        },
    });

    assert.equal(await generateTitle({
        message: 'My query is slow',
        provider: 'local',
        model: 'test-model',
    }), 'Optimize PostgreSQL query performance');
    assert.equal(requestOptions.body.max_tokens, 64);
    assert.match(requestOptions.body.messages[0].content, /do not omit important details/i);
});
