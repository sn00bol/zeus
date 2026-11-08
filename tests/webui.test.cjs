const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const test = require('node:test');

const { createWebUiServer } = require('../webui/app');
const { StreamManager } = require('../webui/streamManager');
const {
    createTitleGenerationService,
    normalizeGeneratedTitle,
} = require('../webui/js/title');

test('image preview exposes zoom presets and custom pan scrollbars without floating prompt actions', () => {
    const markup = fs.readFileSync('webui/index.html', 'utf8');
    assert.match(markup, /data-zoom="25"/);
    assert.match(markup, /data-zoom="200"/);
    assert.match(markup, /id="attachment-image-scrollbar-vertical"/);
    assert.match(markup, /id="attachment-image-scrollbar-horizontal"/);
    assert.match(markup, /id="attachment-file-scrollbar-vertical"/);
    assert.match(markup, /id="attachment-file-scrollbar-horizontal"/);
    assert.doesNotMatch(markup, /attachment-image-floating-prompt|attachment-image-prompt-form|data-image-action=/);
    assert.match(markup, /id="prompt-add-button"/);
    assert.match(markup, /id="message-input"/);
    assert.match(markup, /id="stop-button"[\s\S]*?src="\/icon\/stop\.png"/);
    const chatSource = fs.readFileSync('webui/js/chat.js', 'utf8');
    assert.match(chatSource, /const isGenerating = activeStreams\.has\(conversationId\)\s*&& generatingSessions\.has\(conversationId\)/);
    assert.match(chatSource, /if \(data\.state === 'thinking'\)[\s\S]*?generatingSessions\.add\(sessionId\)/);
    assert.match(chatSource, /stopButton\.hidden = !isGenerating/);
    const themeSource = fs.readFileSync('webui/js/theme.js', 'utf8');
    assert.match(themeSource, /\.send-icon, \.stop-icon \{ filter: brightness\(0\) invert\(1\); \}/);
    assert.match(themeSource, /\.composer\.has-input #send-button \{ display: grid; \}/);
    assert.match(themeSource, /#stop-button\[hidden\] \{ display: none; \}/);
});

test('prompt resize measures wrapping in a stable single-row layout', () => {
    const source = fs.readFileSync('webui/js/chat.js', 'utf8');
    const resizePrompt = source.match(/function resizePrompt\(\) \{([\s\S]*?)\n\}/)?.[1];
    assert.ok(resizePrompt);
    assert.match(resizePrompt, /form\.classList\.remove\('multiline'\);\s*updateAddButtonPlacement\(\);/);
    assert.ok(
        resizePrompt.indexOf("form.classList.remove('multiline')")
            < resizePrompt.indexOf('const height = input.value ? input.scrollHeight : 32'),
    );
    assert.match(resizePrompt, /form\.classList\.toggle\('multiline', multiline\)/);
    const themeSource = fs.readFileSync('webui/js/theme.js', 'utf8');
    assert.match(themeSource, /\.composer\.multiline \{ gap: 2px; padding-bottom: 3px; \}/);
    assert.match(themeSource, /\.composer\.multiline textarea \{ padding-bottom: 1px; \}/);
});

test('conversation export keeps rendered Markdown and escapes document metadata', async () => {
    const source = fs.readFileSync('webui/js/conversationExport.js', 'utf8');
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
    const { buildConversationExportPage } = await import(moduleUrl);
    const page = buildConversationExportPage({
        title: '<Project> "notes"',
        exportedAt: '2025-01-02 & later',
        katexStylesheetUrl: 'https://example.test/katex.css?x=1&y=2',
        messages: [
            { role: 'user', html: '<p>Question with <strong>Markdown</strong></p>' },
            { role: 'system', html: '<p>Do not export system messages</p>' },
            {
                role: 'assistant',
                html: '<h2>Answer</h2><ul><li>List item</li></ul>'
                    + '<pre><code>const answer = 42;</code></pre>'
                    + '<table><tbody><tr><td>Cell</td></tr></tbody></table>',
            },
        ],
    });

    assert.match(page, /&lt;Project&gt; &quot;notes&quot;/);
    assert.match(page, /2025-01-02 &amp; later/);
    assert.match(page, /katex\.css\?x=1&amp;y=2/);
    assert.match(page, /<strong>Markdown<\/strong>/);
    assert.match(page, /<h2>Answer<\/h2>/);
    assert.match(page, /<pre><code>const answer = 42;<\/code><\/pre>/);
    assert.match(page, /<table><tbody><tr><td>Cell<\/td><\/tr><\/tbody><\/table>/);
    assert.doesNotMatch(page, /Do not export system messages/);
    assert.match(page, /@page\s*\{\s*size: A4;/);
    assert.match(page, /name="ProgId" content="Word\.Document"/);
});

test('server-side streams outlive SSE subscribers and replay bounded buffered events', async () => {
    const manager = new StreamManager({
        maxEventsPerStream: 2,
        maxBufferBytesPerStream: 1_024,
    });
    let release;
    let persisted = false;
    let runs = 0;
    const streamId = manager.start(async publish => {
        runs += 1;
        publish('delta', { text: 'first' });
        await new Promise(resolve => { release = resolve; });
        publish('delta', { text: 'second' });
        persisted = true;
        publish('done', { message: { content: 'firstsecond' } });
    }, 'conversation-replay');

    await new Promise(resolve => setImmediate(resolve));
    const firstResponse = new EventEmitter();
    firstResponse.destroyed = false;
    firstResponse.writableEnded = false;
    firstResponse.events = [];
    firstResponse.write = value => firstResponse.events.push(value);
    firstResponse.end = () => { firstResponse.writableEnded = true; };
    firstResponse.destroy = error => { throw error; };
    manager.subscribe(streamId, firstResponse);
    assert.match(firstResponse.events.join(''), /event: delta\ndata: {"text":"first"}/);
    firstResponse.emit('close');
    assert.equal(manager.streams.get(streamId).listeners.size, 0);
    release();
    await manager.streams.get(streamId).task;

    const reconnect = new EventEmitter();
    reconnect.destroyed = false;
    reconnect.writableEnded = false;
    reconnect.events = [];
    reconnect.write = value => reconnect.events.push(value);
    reconnect.end = () => { reconnect.writableEnded = true; };
    reconnect.destroy = error => { throw error; };
    manager.subscribe(streamId, reconnect);

    const replay = reconnect.events.join('');
    assert.match(replay, /event: replay_gap/);
    assert.match(replay, /event: delta\ndata: {"text":"second"}/);
    assert.match(replay, /event: done\ndata: {"message":{"content":"firstsecond"}}/);
    assert.equal(persisted, true);
    assert.equal(runs, 1);
});

test('title generation uses the same automatically selected or user-selected chat model', async () => {
    let requestOptions;
    const requestRoutes = [];
    const generateTitle = createTitleGenerationService({
        request: async (route, options) => {
            requestRoutes.push(route);
            assert.equal(route, '/infer');
            requestOptions = options;
            return { content: 'Title: "FastAPI JWT REST API"' };
        },
    });

    assert.equal(await generateTitle({
        message: 'Write a REST API using FastAPI with JWT authentication.',
        provider: 'lmstudio',
        model: 'selected-by-user',
    }), 'FastAPI JWT REST API');
    assert.equal(requestOptions.timeoutMs, 15_000);
    assert.equal(requestOptions.body.provider, 'lmstudio');
    assert.equal(requestOptions.body.model, 'selected-by-user');
    assert.equal(requestOptions.body.stream, false);
    assert.equal(requestOptions.body.temperature, 0.1);
    assert.equal(requestOptions.body.max_tokens, 64);
    assert.equal(requestOptions.body.think, false);
    assert.equal(requestOptions.body.strict_model, true);
    assert.deepEqual(requestOptions.body.messages.map(message => message.role), ['system', 'user']);
    assert.match(requestOptions.body.messages[0].content, /only a greeting or has no substantive intent/i);
    assert.equal(normalizeGeneratedTitle('```text\nPostgreSQL vs SQLite\n```'), 'PostgreSQL vs SQLite');
    assert.equal(normalizeGeneratedTitle('Question'), 'Question');
    assert.equal(
        normalizeGeneratedTitle(
            'How to optimize a PostgreSQL query without losing existing indexes. '
            + 'Keep the current query plan stable.',
        ),
        'How to optimize a PostgreSQL query without losing existing indexes. '
            + 'Keep the current query plan stable.',
    );
    assert.deepEqual(requestRoutes, ['/infer']);
});

test('title generation can use the automatic model when the response was stopped early', async () => {
    let requestOptions;
    const generateTitle = createTitleGenerationService({ request: async (route, options) => {
        assert.equal(route, '/infer');
        requestOptions = options;
        return { content: 'Conversation title' };
    } });
    assert.equal(await generateTitle({ message: 'Summarize this conversation.' }), 'Conversation title');
    assert.equal(requestOptions.body.provider, undefined);
    assert.equal(requestOptions.body.model, undefined);
    assert.equal(requestOptions.body.strict_model, false);

    await assert.rejects(
        generateTitle({
            message: 'Summarize this conversation.',
            provider: 'ollama',
        }),
        /must include both provider and model/,
    );

    await generateTitle({
        message: [
            { type: 'text', text: 'Create a title for this image.' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,aW1n' } },
        ],
    });
    assert.deepEqual(requestOptions.body.messages[1].content, [
        { type: 'text', text: 'Create a title for this image.' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,aW1n' } },
    ]);
});

test('title generation continues after the chat stream is stopped', async () => {
    const metadata = {};
    let resolveGeneratedTitle;
    let markTitleStarted;
    let markInferenceStarted;
    let markTitleSaved;
    const titleStarted = new Promise(resolve => { markTitleStarted = resolve; });
    const inferenceStarted = new Promise(resolve => { markInferenceStarted = resolve; });
    const titleSaved = new Promise(resolve => { markTitleSaved = resolve; });
    const streamManager = new StreamManager();
    const server = createWebUiServer({
        db: {
            appendMessage: async () => {},
            getMessages: async () => [{ role: 'user', content: 'Explain Docker.' }],
            getModelPreference: async () => ({ provider: 'ollama', model: 'main-model' }),
            pool: {
                query: async (query, values = []) => {
                    if (query.includes('WITH first_user_message')) {
                        Object.assign(metadata, {
                            title: 'New conversation',
                            title_source: 'default',
                            title_status: 'pending',
                        });
                        return { rows: [{ prompt: 'Explain Docker.' }] };
                    }
                    if (query.includes("metadata->>'title_status' = 'pending'")) {
                        Object.assign(metadata, {
                            title: values[2],
                            title_source: values[3],
                            title_status: values[4],
                        });
                        markTitleSaved();
                    }
                    return { rows: [] };
                },
            },
        },
        bridgeSse: async (route, { signal }) => {
            markInferenceStarted();
            return new Promise((resolve, reject) => {
                signal.addEventListener('abort', () => {
                    reject(new Error('The chat was stopped.'));
                }, { once: true });
            });
        },
        titleGenerator: async options => {
            assert.equal(options.provider, 'ollama');
            assert.equal(options.model, 'main-model');
            markTitleStarted();
            return new Promise(resolve => { resolveGeneratedTitle = resolve; });
        },
        streamManager,
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                conversationId: 'stopped-title-chat',
                message: 'Explain Docker.',
            }),
        });
        assert.equal(response.status, 202);
        const { streamId } = await response.json();
        await Promise.all([titleStarted, inferenceStarted]);
        assert.equal(streamManager.cancel(streamId), true);
        await streamManager.streams.get(streamId).task;

        resolveGeneratedTitle('Docker containers explained');
        await titleSaved;
        assert.equal(metadata.title, 'Docker containers explained');
        assert.equal(metadata.title_source, 'ai');
        assert.equal(metadata.title_status, 'generated');
    } finally {
        await new Promise((resolve, reject) => server.close(error => (
            error ? reject(error) : resolve()
        )));
    }
});

test('attachment-only conversations generate a title from text and image attachments', async () => {
    const metadata = {};
    let markTitleSaved;
    const titleSaved = new Promise(resolve => { markTitleSaved = resolve; });
    const streamManager = new StreamManager();
    const server = createWebUiServer({
        db: {
            appendMessage: async () => {},
            getMessages: async () => [{
                role: 'user',
                content: 'Please analyze the attached file(s).',
            }],
            getModelPreference: async () => null,
            pool: {
                query: async (query, values = []) => {
                    if (query.includes('WITH first_user_message')) {
                        Object.assign(metadata, {
                            title: 'New conversation',
                            title_source: 'default',
                            title_status: 'pending',
                        });
                        return { rows: [{ prompt: 'Please analyze the attached file(s).' }] };
                    }
                    if (query.includes("metadata->>'title_status' = 'pending'")) {
                        Object.assign(metadata, {
                            title: values[2],
                            title_source: values[3],
                            title_status: values[4],
                        });
                        markTitleSaved();
                    }
                    return { rows: [] };
                },
            },
        },
        bridgeSse: async () => ({
            content: 'Attachment analyzed.',
            model: 'main-model',
            provider: 'ollama',
        }),
        titleGenerator: async ({ message }) => {
            assert.equal(message[0].type, 'text');
            assert.match(message[0].text, /receipt\.png/);
            assert.match(message[0].text, /Some attached notes\./);
            assert.deepEqual(message[1], {
                type: 'image_url',
                image_url: { url: 'data:image/png;base64,aW1n' },
            });
            return 'Receipt and notes';
        },
        streamManager,
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                conversationId: 'attachment-only-chat',
                message: '',
                attachments: [{
                    kind: 'text',
                    name: 'notes.txt',
                    type: 'text/plain',
                    text: 'Some attached notes.',
                }, {
                    kind: 'image',
                    name: 'receipt.png',
                    type: 'image/png',
                    data: 'data:image/png;base64,aW1n',
                }],
            }),
        });
        assert.equal(response.status, 202);
        const { streamId } = await response.json();
        await streamManager.streams.get(streamId).task;
        await titleSaved;
        assert.equal(metadata.title, 'Receipt and notes');
        assert.equal(metadata.title_source, 'ai');
        assert.equal(metadata.title_status, 'generated');
    } finally {
        await new Promise((resolve, reject) => server.close(error => (
            error ? reject(error) : resolve()
        )));
    }
});

test('temporary conversation IDs are never persisted without a client temporary flag', async () => {
    const appendedMessages = [];
    const streamManager = new StreamManager();
    const server = createWebUiServer({
        db: {
            appendMessage: async message => appendedMessages.push(message),
            getMessages: async () => [{ role: 'user', content: 'persistent prompt' }],
            getModelPreference: async () => null,
            pool: { query: async () => ({}) },
        },
        bridgeSse: async (route, options) => {
            assert.equal(route, '/infer');
            assert.deepEqual(
                options.body.tools,
                options.body.session.conversation_id === 'temp-123' ? [] : ['search'],
            );
            assert.deepEqual(options.body.messages, [{
                role: 'user',
                content: options.body.session.conversation_id === 'temp-123'
                    ? 'temporary prompt'
                    : 'persistent prompt',
            }]);
            return {
                content: 'temporary response',
                model: 'local-model',
                provider: 'ollama',
                prompt_tokens: 1,
                completion_tokens: 1,
            };
        },
        streamManager,
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                conversationId: 'temp-123',
                message: 'temporary prompt',
            }),
        });
        assert.equal(response.status, 202);
        const { streamId } = await response.json();
        await streamManager.streams.get(streamId).task;
        assert.deepEqual(appendedMessages, []);

        const persistentResponse = await fetch(
            `http://127.0.0.1:${server.address().port}/api/chat`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    conversationId: 'conversation-123',
                    message: 'persistent prompt',
                    tools: ['search'],
                }),
            },
        );
        assert.equal(persistentResponse.status, 202);
        const persistentStream = await persistentResponse.json();
        await streamManager.streams.get(persistentStream.streamId).task;
        assert.deepEqual(appendedMessages.map(message => message.role), ['user', 'assistant']);
        assert.deepEqual(appendedMessages[0].tools, ['search']);
    } finally {
        await new Promise((resolve, reject) => server.close(error => (
            error ? reject(error) : resolve()
        )));
    }
});

test('chat attachments forward images and text files while rejecting unsupported files', async () => {
    const savedMessages = [];
    const streamManager = new StreamManager();
    let inferenceMessages;
    const server = createWebUiServer({
        db: {
            appendMessage: async message => savedMessages.push(message),
            getMessages: async () => savedMessages.filter(message => message.role === 'user'),
            getModelPreference: async () => null,
            pool: { query: async () => ({ rows: [] }) },
        },
        bridgeSse: async (route, options) => {
            inferenceMessages = options.body.messages;
            return {
                content: 'image answer',
                model: 'vision-model',
                provider: 'ollama',
                prompt_tokens: 1,
                completion_tokens: 1,
            };
        },
        streamManager,
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                conversationId: 'attachment-chat',
                message: 'What is in this picture?',
                attachments: [
                    {
                        kind: 'image',
                        name: 'sample.png',
                        type: 'image/png',
                        data: 'data:image/png;base64,aW1n',
                    },
                    {
                        kind: 'text',
                        name: 'main.py',
                        type: 'text/x-python',
                        text: 'print("hello")',
                    },
                ],
            }),
        });
        assert.equal(response.status, 202);
        const { streamId } = await response.json();
        await streamManager.streams.get(streamId).task;

        assert.equal(savedMessages[0].attachments.length, 2);
        assert.equal(inferenceMessages[0].content[0].type, 'text');
        assert.match(inferenceMessages[0].content[0].text, /What is in this picture\?/);
        assert.match(inferenceMessages[0].content[0].text, /print\("hello"\)/);
        assert.deepEqual(inferenceMessages[0].content[1], {
            type: 'image_url',
            image_url: { url: 'data:image/png;base64,aW1n' },
        });

        const rejected = await fetch(`http://127.0.0.1:${server.address().port}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                conversationId: 'attachment-chat',
                message: 'Read this',
                attachments: [{
                    kind: 'text',
                    name: 'archive.zip',
                    type: 'application/zip',
                    text: 'not text',
                }],
            }),
        });
        assert.equal(rejected.status, 400);
        assert.match((await rejected.json()).error, /not a supported text or code file/);
    } finally {
        await new Promise((resolve, reject) => server.close(error => (
            error ? reject(error) : resolve()
        )));
    }
});

test('title generation does not block the main response or overwrite a user rename', async () => {
    const appendedMessages = [];
    const metadata = {};
    let resolveGeneratedTitle;
    let markTitleStarted;
    let markTitleSaved;
    let mainResponseReturned = false;
    const titleStarted = new Promise(resolve => { markTitleStarted = resolve; });
    const titleSaved = new Promise(resolve => { markTitleSaved = resolve; });
    const streamManager = new StreamManager();
    const server = createWebUiServer({
        db: {
            appendMessage: async message => appendedMessages.push(message),
            getMessages: async () => [{ role: 'user', content: 'Explain Docker.' }],
            getModelPreference: async () => ({ provider: 'ollama', model: 'main-model' }),
            pool: {
                query: async (query, values = []) => {
                    if (query.includes('WITH first_user_message')) {
                        Object.assign(metadata, {
                            title: 'New conversation',
                            title_source: 'default',
                            title_status: 'pending',
                        });
                        return { rows: [{ prompt: 'Explain Docker.' }] };
                    }
                    if (query.includes('SELECT metadata')) {
                        return { rowCount: 1, rows: [{ metadata }] };
                    }
                    if (query.includes("metadata = metadata || $3::jsonb")) {
                        Object.assign(metadata, JSON.parse(values[2]));
                        return { rowCount: 1, rows: [] };
                    }
                    if (query.includes("metadata->>'title_status' = 'pending'")) {
                        if (metadata.title_status === 'pending' && metadata.title_source === 'default') {
                            Object.assign(metadata, {
                                title: values[2],
                                title_source: values[3],
                                title_status: values[4],
                            });
                        }
                        markTitleSaved();
                        return { rowCount: 1, rows: [] };
                    }
                    return { rows: [] };
                },
            },
        },
        bridgeSse: async () => {
            mainResponseReturned = true;
            return {
                content: 'Docker is a containerization platform.',
                model: 'main-model',
                provider: 'ollama',
            };
        },
        titleGenerator: async options => {
            assert.equal(mainResponseReturned, false);
            assert.equal(options.provider, 'ollama');
            assert.equal(options.model, 'main-model');
            markTitleStarted();
            return new Promise(resolve => { resolveGeneratedTitle = resolve; });
        },
        streamManager,
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                conversationId: 'title-async-chat',
                message: 'Explain Docker.',
            }),
        });
        assert.equal(response.status, 202);
        const { streamId } = await response.json();
        await streamManager.streams.get(streamId).task;
        await titleStarted;
        assert.deepEqual(appendedMessages.map(message => message.role), ['user', 'assistant']);
        assert.equal(metadata.title_status, 'pending');

        const renameResponse = await fetch(
            `http://127.0.0.1:${server.address().port}/api/conversations/title-async-chat`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'rename', title: 'My Docker notes' }),
            },
        );
        assert.equal(renameResponse.status, 200);
        assert.equal(metadata.title_source, 'user');
        resolveGeneratedTitle('Docker containers explained');
        await titleSaved;
        assert.equal(metadata.title, 'My Docker notes');
        assert.equal(metadata.title_status, 'generated');
    } finally {
        await new Promise((resolve, reject) => server.close(error => (
            error ? reject(error) : resolve()
        )));
    }
});

test('conversation API hides temporary conversations left by older versions', async () => {
    let conversationQuery = '';
    const server = createWebUiServer({
        db: {
            pool: {
                query: async query => {
                    conversationQuery = query;
                    return {
                        rows: [
                            { conversation_id: 'temp-legacy', metadata: {}, preview: 'Temporary chat' },
                            {
                                conversation_id: 'saved-chat',
                                metadata: { title_status: 'pending' },
                                preview: 'New conversation',
                            },
                        ],
                    };
                },
            },
        },
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        const response = await fetch(
            `http://127.0.0.1:${server.address().port}/api/conversations?archived=all`,
        );
        assert.equal(response.status, 200);
        const { conversations } = await response.json();
        assert.deepEqual(conversations.map(conversation => conversation.conversation_id), ['saved-chat']);
        assert.equal(conversations[0].is_title_generating, true);
        assert.match(conversationQuery, /conversation_id NOT LIKE 'temp-%'/);
    } finally {
        await new Promise((resolve, reject) => server.close(error => (
            error ? reject(error) : resolve()
        )));
    }
});

test('about endpoint reports ZEUS and runtime versions with SearXNG availability', async () => {
    const previousSearxngUrl = process.env.SEARXNG_URL;
    const previousSearxngVersion = process.env.SEARXNG_VERSION;
    const searxng = http.createServer((request, response) => {
        response.writeHead(200);
        response.end('ready');
    });
    await new Promise(resolve => searxng.listen(0, '127.0.0.1', resolve));
    process.env.SEARXNG_URL = `http://127.0.0.1:${searxng.address().port}`;
    process.env.SEARXNG_VERSION = 'latest';

    const server = createWebUiServer({
        db: {},
        bridgeRequest: async route => {
            assert.equal(route, '/about');
            return {
                python_version: '3.13.4',
                dependencies: [{ name: 'httpx', version: '0.28.1' }],
            };
        },
    });
    try {
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const { port } = server.address();
        const response = await fetch(`http://127.0.0.1:${port}/api/about`);
        assert.equal(response.status, 200);
        const about = await response.json();
        assert.equal(about.zeus.value, require('node:fs').readFileSync('version', 'utf8').trim());
        assert.equal(about.node.version, process.version);
        assert.equal(about.python.version, '3.13.4');
        assert.deepEqual(about.python.dependencies, [{ name: 'httpx', version: '0.28.1' }]);
        assert.deepEqual(
            about.node.dependencies.map(dependency => dependency.name),
            Object.keys(require('../package.json').dependencies),
        );
        assert.ok(about.node.dependencies.every(dependency => dependency.version));
        assert.equal(about.python.status, 'online');
        assert.equal(about.searxng.value, 'Available');
        assert.doesNotMatch(JSON.stringify(about.searxng), /latest/);
        assert.equal(about.searxng.status, 'online');
    } finally {
        await new Promise(resolve => server.close(resolve));
        await new Promise(resolve => searxng.close(resolve));
        if (previousSearxngUrl === undefined) delete process.env.SEARXNG_URL;
        else process.env.SEARXNG_URL = previousSearxngUrl;
        if (previousSearxngVersion === undefined) delete process.env.SEARXNG_VERSION;
        else process.env.SEARXNG_VERSION = previousSearxngVersion;
    }
});

test('project document routes serve the repository Markdown files', async () => {
    const server = createWebUiServer({
        db: {},
        bridgeRequest: async () => ({}),
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        const base = `http://127.0.0.1:${server.address().port}`;
        for (const file of ['CONTRIBUTING.md', 'SECURITY.md', 'PRIVACY.md']) {
            const response = await fetch(`${base}/project-docs/${file}`);
            assert.equal(response.status, 200);
            assert.match(response.headers.get('content-type'), /text\/markdown/);
            assert.equal(await response.text(), require('node:fs').readFileSync(file, 'utf8'));
        }
        const unknownDocument = await fetch(`${base}/project-docs/README.md`);
        assert.equal(unknownDocument.status, 404);
    } finally {
        await new Promise((resolve, reject) => server.close(error => (
            error ? reject(error) : resolve()
        )));
    }
});

test('conversation export module is served as a WebUI JavaScript asset', async () => {
    const server = createWebUiServer({ db: {} });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        const response = await fetch(
            `http://127.0.0.1:${server.address().port}/js/conversationExport.js`,
        );
        assert.equal(response.status, 200);
        assert.match(response.headers.get('content-type'), /text\/javascript/);
        assert.match(await response.text(), /buildConversationExportPage/);
    } finally {
        await new Promise((resolve, reject) => server.close(error => (
            error ? reject(error) : resolve()
        )));
    }
});

test('stop icon is served as a WebUI image asset', async () => {
    const server = createWebUiServer({ db: {} });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/icon/stop.png`);
        assert.equal(response.status, 200);
        assert.match(response.headers.get('content-type'), /image\/png/);
        assert.ok((await response.arrayBuffer()).byteLength > 0);
    } finally {
        await new Promise((resolve, reject) => server.close(error => (
            error ? reject(error) : resolve()
        )));
    }
});

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
        const version = require('node:fs').readFileSync('version', 'utf8').trim();
        assert.ok(page.body.toString('utf8').includes(
            `<meta name="zeus-version" content="${version}">`,
        ));
        assert.doesNotMatch(page.body.toString('utf8'), /rel="preload" href="\/font\/Streetsign-Sans\.otf" as="font"/);
        assert.match(page.body.toString('utf8'), /localStorage\.getItem\('zeus\.webui\.theme'\)/);
        assert.match(page.body.toString('utf8'), /document\.documentElement\.dataset\.themeMode = mode/);
        assert.match(page.body.toString('utf8'), /document\.body\.dataset\.themeMode = document\.documentElement\.dataset\.themeMode/);
        assert.match(page.body.toString('utf8'), /html\[data-theme-mode="light"\], html\[data-theme-mode="light"\] body/);
        assert.match(page.body.toString('utf8'), /<body>\s*<script>[\s\S]*?<\/script>\s*<div class="app"/);
        assert.match(page.body.toString('utf8'), /src="\/ZEUSbanner\.png"/);
        assert.match(page.body.toString('utf8'), /src="\/vendor\/markdown-it\/markdown-it\.min\.js"/);
        assert.match(page.body.toString('utf8'), /src="\/vendor\/task-lists\/markdown-it-task-lists\.min\.js"/);
        assert.doesNotMatch(page.body.toString('utf8'), /cdn\.jsdelivr\.net/);
        assert.match(page.body.toString('utf8'), /class="chat-title-button" id="chat-title-button"/);
        assert.match(page.body.toString('utf8'), /id="stop-button"/);
        assert.match(page.body.toString('utf8'), /id="rename-dialog"/);
        assert.doesNotMatch(page.body.toString('utf8'), /id="chat-more-button"/);
        const currentBootId = page.body.toString('utf8').match(
            /<meta name="zeus-boot-id" content="([^"]+)">/,
        )[1];

        const theme = await requestRaw('/js/theme.js');
        assert.equal(theme.status, 200);
        assert.match(theme.body.toString('utf8'), /font-family:\s*Geist,\s*sans-serif/);
        assert.match(theme.body.toString('utf8'), /Geist-BoldItalic\.ttf/);
        assert.match(theme.body.toString('utf8'), /--accent:\s*#1d4ed8/);
        assert.match(theme.body.toString('utf8'), /background:\s*#000000/);
        assert.match(theme.body.toString('utf8'), /\.sidebar-settings-button \{ position: absolute;/);
        assert.match(theme.body.toString('utf8'), /\.app\.menu-closed \.sidebar-settings-button \{ right: 10px;/);
        assert.doesNotMatch(theme.body.toString('utf8'), /#fb923c|#fdba74|#ffedd5|#100d0b|#15110e|#191410|#211912/);
        assert.match(theme.body.toString('utf8'), /body:not\(\.temp-chat-mode\)\[data-theme-mode="light"\] \.conversation-action/);
        assert.match(theme.body.toString('utf8'), /body:not\(\.temp-chat-mode\)\[data-theme-mode="dark"\] \.temp-chat-button/);
        assert.match(theme.body.toString('utf8'), /body\.temp-chat-mode \.menubar-brand img \{ filter: grayscale\(1\) brightness\(\.55\); \}/);
        assert.match(theme.body.toString('utf8'), /\.chat-title-button:hover,[\s\S]*?background: color-mix\(in srgb, var\(--user-foreground\) 8%, transparent\)/);
        assert.match(theme.body.toString('utf8'), /body\[data-theme-mode="light"\] \.menu-toggle img,[\s\S]*?filter: brightness\(0\);/);
        assert.match(theme.body.toString('utf8'), /body:not\(\.temp-chat-mode\)\[data-theme-mode="light"\] \.menu-toggle:hover,[\s\S]*?\.sidebar-search-btn:hover,[\s\S]*?\.new-chat:hover,[\s\S]*?\.temp-chat-button:hover,[\s\S]*?background-color: #0000000a;/);
        assert.match(theme.body.toString('utf8'), /body:not\(\.temp-chat-mode\)\[data-theme-mode="dark"\] \.menu-toggle:hover,[\s\S]*?\.sidebar-search-btn:hover,[\s\S]*?\.new-chat:hover,[\s\S]*?\.temp-chat-button:hover,[\s\S]*?background-color: #ffffff0c;/);
        assert.match(theme.body.toString('utf8'), /\.menu-toggle \{[^}]*appearance: none;[^}]*background: transparent;/);
        assert.match(theme.body.toString('utf8'), /body\[data-theme-mode="light"\] \.menu-toggle:hover \.sidebar-icon,[\s\S]*?filter: brightness\(0\);/);
        assert.match(theme.body.toString('utf8'), /body:not\(\.temp-chat-mode\)\[data-theme-mode="light"\] \.thinking-mode-button\.active/);
        assert.match(theme.body.toString('utf8'), /body\[data-theme-mode="light"\] \.app\.menu-closed \.collapsed-icon-img/);
        assert.match(theme.body.toString('utf8'), /body:not\(\.temp-chat-mode\)\[data-theme-mode="dark"\] \.message\.user \.message-body/);
        assert.match(theme.body.toString('utf8'), /body\[data-theme-mode="dark"\] \.settings-dialog/);
        assert.match(theme.body.toString('utf8'), /body\[data-theme-mode="dark"\] \.settings-dialog,[\s\S]*?background:\s*#111111/);
        assert.match(theme.body.toString('utf8'), /body\[data-theme-mode="dark"\] \.settings-sidebar,[\s\S]*?background:\s*#191919/);
        assert.match(theme.body.toString('utf8'), /body\[data-theme-mode="light"\] \.settings-info-project-item \{ color: #404040; \}/);
        assert.match(theme.body.toString('utf8'), /body\[data-theme-mode="light"\] \.settings-doc-dialog-content \{ color: #404040; \}/);
        assert.match(theme.body.toString('utf8'), /\.temp-chat-button \{ width: 36px; height: 36px;[^}]*background: transparent;/);
        assert.match(theme.body.toString('utf8'), /\.chat-title-button \{ max-width: 100%; height: 36px;[^}]*background: transparent;/);
        assert.match(theme.body.toString('utf8'), /\.temp-chat-button img \{ width: 20px; height: 20px; \}/);
        assert.match(theme.body.toString('utf8'), /\.chat-title-button svg \{ flex: none; opacity: \.7; \}/);
        assert.doesNotMatch(theme.body.toString('utf8'), /body:not\(\.temp-chat-mode\)\[data-theme-mode="(?:light|dark)"\] \.temp-chat-button,[\s\S]{0,100}?background:\s*#[0-9a-f]{3,8}/i);
        assert.match(theme.body.toString('utf8'), /body:not\(\.temp-chat-mode\)\[data-theme-mode="light"\] \.new-chat:hover \.newchat-icon/);
        assert.match(theme.body.toString('utf8'), /body:not\(\.temp-chat-mode\)\[data-theme-mode="dark"\] \.source-pill:hover/);
        assert.match(theme.body.toString('utf8'), /body:not\(\.temp-chat-mode\)\[data-theme-mode="light"\] \.source-pill:hover \.source-pill-domain/);
        assert.match(theme.body.toString('utf8'), /body:not\(\.temp-chat-mode\)\[data-theme-mode="dark"\] \.task-list-item-checkbox/);
        assert.match(theme.body.toString('utf8'), /body:not\(\.temp-chat-mode\)\[data-theme-mode="light"\] \.source-pill \{/);
        assert.match(theme.body.toString('utf8'), /body:not\(\.temp-chat-mode\)\[data-theme-mode="dark"\] \.source-pill \{/);
        assert.match(theme.body.toString('utf8'), /body:not\(\.temp-chat-mode\)\[data-theme-mode="dark"\] \.settings-search-result:hover/);
        assert.match(theme.body.toString('utf8'), /\.chat-scrollbar \{[^}]*width:\s*30px;[^}]*pointer-events:\s*auto;/);
        assert.match(theme.body.toString('utf8'), /\.chat-scrollbar::before \{[^}]*pointer-events:\s*none;/);
        assert.match(theme.body.toString('utf8'), /\.chat-scrollbar:hover \{ opacity:\s*\.55; \}/);
        assert.doesNotMatch(theme.body.toString('utf8'), /#a78bfa|#c4b5fd/);
        assert.match(theme.body.toString('utf8'), /\.message\.user \.message-body \{[^}]*border-radius: 999px;/);
        assert.match(theme.body.toString('utf8'), /\.message\.user \.message-body \{[^}]*padding: 11px 15px 0;/);
        assert.match(theme.body.toString('utf8'), /\.send-icon, \.stop-icon \{ filter: brightness\(0\) invert\(1\); \}/);
        assert.doesNotMatch(theme.body.toString('utf8'), /\.composer:focus-within/);
        assert.match(theme.body.toString('utf8'), /body:not\(\.temp-chat-mode\)\[data-theme-mode="light"\] \.message-content pre code \{ color: #262626; \}/);
        assert.match(theme.body.toString('utf8'), /body:not\(\.temp-chat-mode\)\[data-theme-mode="light"\] \.attachment-code-rendered pre code \{ color: #262626; \}/);
        assert.match(theme.body.toString('utf8'), /body:not\(\.temp-chat-mode\)\[data-theme-mode="light"\] \.message-content pre code \.tok-kw/);
        assert.match(theme.body.toString('utf8'), /body:not\(\.temp-chat-mode\)\[data-theme-mode="light"\] \.attachment-code-rendered pre code \.tok-kw/);
        assert.match(theme.body.toString('utf8'), /body:not\(\.temp-chat-mode\)\[data-theme-mode="light"\] \.attachment-preview-button \{ color: #404040; border-color: transparent; background: transparent; \}/);
        assert.match(theme.body.toString('utf8'), /\.attachment-preview-button \{[^}]*border: 1px solid transparent;[^}]*background: transparent;/);
        assert.match(theme.body.toString('utf8'), /body\.temp-chat-mode\[data-theme-mode="light"\] \.attachment-preview-button \{ color: #f3f4f6; border-color: transparent; background: transparent; \}/);
        assert.match(theme.body.toString('utf8'), /\.message-content pre > \.code-horizontal-scrollbar/);
        assert.match(theme.body.toString('utf8'), /body:not\(\.temp-chat-mode\)\[data-theme-mode="light"\] \.math-inline,/);
        assert.match(theme.body.toString('utf8'), /body:not\(\.temp-chat-mode\)\[data-theme-mode="light"\] \.markdown-table th \{ color: #262626; background: #f5f5f5;/);
        assert.match(theme.body.toString('utf8'), /body:not\(\.temp-chat-mode\)\[data-theme-mode="light"\] \.message-content mark \{ color: #713f12; background: #fef08a; \}/);

        for (const assetPath of [
            '/js/renderMath.js',
            '/js/renderHTML.js',
            '/js/settings.js',
            '/js/scrollbar.js',
            '/icon/model.png',
            '/icon/search.png',
            '/icon/stop.png',
            '/icon/appearance.png',
            '/icon/terminal.png',
            '/icon/more.png',
            '/icon/refresh.png',
            '/icon/picture.png',
            '/icon/brain.png',
            '/icon/ollama.png',
            '/icon/lmstudio.png',
            '/icon/llama-cpp.png',
            '/icon/settings.png',
            '/icon/shortcut.png',
            '/icon/info.png',
            '/vendor/katex/katex.min.css',
            '/vendor/katex/katex.min.js',
            '/vendor/dompurify/purify.min.js',
            '/vendor/markdown-it/markdown-it.min.js',
            '/vendor/task-lists/markdown-it-task-lists.min.js',
            '/vendor/katex/fonts/KaTeX_Main-Regular.woff2',
            '/font/Geist-Regular.ttf',
            '/font/Geist-Bold.ttf',
            '/font/Geist-Italic.ttf',
            '/font/Geist-BoldItalic.ttf',
            '/font/Streetsign-Sans.otf',
        ]) {
            const asset = await requestRaw(assetPath);
            assert.equal(asset.status, 200, `${assetPath} should be served`);
            assert.ok(asset.body.length > 0, `${assetPath} should not be empty`);
        }

        const settings = await requestRaw('/js/settings.js');
        assert.equal(settings.status, 200);
        assert.match(settings.body.toString('utf8'), /openSection,\s*\n\s*\};/);
        assert.match(settings.body.toString('utf8'), /Model Manager/);
        assert.match(settings.body.toString('utf8'), /data-page="shortcuts" hidden/);
        assert.match(settings.body.toString('utf8'), /<h2 class="settings-section-title">Model Manager<\/h2>/);
        assert.match(settings.body.toString('utf8'), /settings-catalog-refresh/);
        assert.match(settings.body.toString('utf8'), /class="settings-search"/);
        const chat = await requestRaw('/js/chat.js');
        assert.equal(chat.status, 200);
        assert.match(chat.body.toString('utf8'), /textContent = 'Manage models\.\.\.'/);
        assert.match(chat.body.toString('utf8'), /settings\?\.openSection\('models'\)/);
        assert.match(chat.body.toString('utf8'), /chatMoreButton\.hidden = messagesElement\.childElementCount === 0/);
        assert.match(chat.body.toString('utf8'), /messagesElement = tempContainer;[\s\S]{0,80}chatMoreButton\.hidden = true/);
        assert.match(chat.body.toString('utf8'), /if \(chatMoreButton\) chatMoreButton\.hidden = false;\s*\n\s*try \{/);
        assert.match(theme.body.toString('utf8'), /body\[data-theme-mode="light"\] \.settings-search-wrap\.search-open \.settings-search,[\s\S]*?background: #ffffff/);
        assert.match(theme.body.toString('utf8'), /body\[data-theme-mode="light"\] \.settings-search-wrap\.search-open \.settings-search::placeholder/);
        assert.match(theme.body.toString('utf8'), /body\[data-theme-mode="light"\] \.search-result-item \{ color: #404040; \}/);
        assert.match(theme.body.toString('utf8'), /body\[data-theme-mode="light"\] \.search-result-item:hover,[\s\S]*?background: #e5e5e5;/);
        assert.match(theme.body.toString('utf8'), /body\[data-theme-mode="light"\] \.search-result-icon \{ color: #525252; background: #0000000a; \}/);
        assert.match(settings.body.toString('utf8'), /settings-search-results chat-scroll/);
        assert.match(settings.body.toString('utf8'), /data-theme-option="light"/);
        assert.match(settings.body.toString('utf8'), /data-theme-option="dark"/);
        assert.match(settings.body.toString('utf8'), /data-theme-option="system"/);
        assert.match(settings.body.toString('utf8'), /selectedTheme === 'zeus'/);
        assert.match(settings.body.toString('utf8'), /writePreference\('zeus\.webui\.theme', selectedTheme\)/);
        assert.equal((settings.body.toString('utf8').match(/<button class="settings-theme-option"/g) || []).length, 3);
        assert.match(settings.body.toString('utf8'), /data-theme-preview="light"/);
        assert.match(settings.body.toString('utf8'), /data-theme-preview="dark"/);
        assert.match(settings.body.toString('utf8'), /data-theme-preview="system"/);
        assert.match(settings.body.toString('utf8'), /settings-theme-preview-system-light/);
        assert.match(settings.body.toString('utf8'), /settings-theme-preview-system-dark/);
        assert.match(settings.body.toString('utf8'), /id="settings-theme-title">Mode<\/h3>/);
        assert.doesNotMatch(settings.body.toString('utf8'), /Color theme|Choose how ZEUS looks across this interface|data-theme-option="zeus"|settings-theme-radio/);
        assert.match(settings.body.toString('utf8'), /class="settings-theme-option" type="button" data-theme-option="light"/);
        assert.match(settings.body.toString('utf8'), /settings-theme-mode-card/);
        assert.doesNotMatch(settings.body.toString('utf8'), /settings-theme-preview \{ min-height:/);
        assert.match(settings.body.toString('utf8'), /data-color-input="accent"/);
        assert.match(settings.body.toString('utf8'), /data-color-input="sidebar"/);
        assert.match(settings.body.toString('utf8'), /data-color-input="background"/);
        assert.match(settings.body.toString('utf8'), /data-color-input="foreground"/);
        assert.match(settings.body.toString('utf8'), /#RRGGBB/);
        assert.match(settings.body.toString('utf8'), /#RRGGBBAA/);
        assert.match(settings.body.toString('utf8'), /data-setting="reset-colors"/);
        assert.doesNotMatch(settings.body.toString('utf8'), /Compact interface|Reduce motion|settings-custom-color-title/);
        assert.match(theme.body.toString('utf8'), /background:\s*var\(--user-background\)/);
        assert.match(theme.body.toString('utf8'), /background:\s*var\(--user-sidebar\)/);
        assert.match(theme.body.toString('utf8'), /color:\s*var\(--user-foreground\)/);
        assert.match(theme.body.toString('utf8'), /body:not\(\.temp-chat-mode\)\[data-theme-mode="dark"\] \.sidebar-search-btn:hover \{ color: #ffffff; background: #ffffff0c; \}/);
        assert.match(theme.body.toString('utf8'), /\.chat-title-button:hover, \.chat-title-button:focus-visible, \.chat-title-button\[aria-expanded="true"\]/);
        assert.match(theme.body.toString('utf8'), /body:not\(\.temp-chat-mode\)\[data-theme-mode="light"\] \.rename-title-input \{ border-color: #d4d4d4; color: #262626; background: #f5f5f5; \}/);
        assert.match(theme.body.toString('utf8'), /body\.temp-chat-mode\[data-theme-mode="light"\] \{ color-scheme: dark; background: #000000; color: #ededed; \}/);
        assert.match(theme.body.toString('utf8'), /body\.temp-chat-mode \.app\.menu-closed \.sidebar,[\s\S]*?background: #000000; border-right-color: #222222;/);
        assert.match(settings.body.toString('utf8'), /body\[data-theme-mode="light"\] \.settings-switch/);
        assert.match(settings.body.toString('utf8'), /body\[data-theme-mode="dark"\] \.settings-model-badge/);
        assert.match(settings.body.toString('utf8'), /aria-label="Settings page scroll position"/);
        assert.match(settings.body.toString('utf8'), /settings-doc-dialog-content chat-scroll/);
        assert.match(settings.body.toString('utf8'), /class="chat-scrollbar"/);
        assert.doesNotMatch(settings.body.toString('utf8'), /\.settings-doc-scrollbar/);
        assert.match(settings.body.toString('utf8'), /label: 'About ZEUS', keywords: 'about zeus version information'/);
        assert.match(settings.body.toString('utf8'), /data-runtime-dependencies="node"/);
        assert.match(settings.body.toString('utf8'), /data-runtime-dependencies="python"/);
        assert.match(settings.body.toString('utf8'), /data-info-runtime="node"/);
        assert.match(settings.body.toString('utf8'), /data-info-runtime="python"/);
        assert.match(settings.body.toString('utf8'), /void loadSystemInfo\(\);\s*function applyTheme\(\)/);
        assert.match(settings.body.toString('utf8'), /meta\[name="zeus-version"\]/);
        assert.match(settings.body.toString('utf8'), /versionValue\.textContent = initialVersion/);
        assert.doesNotMatch(settings.body.toString('utf8'), /settings-info-banner-in/);
        assert.doesNotMatch(settings.body.toString('utf8'), /settings-info-card-in|settings-info-enter[\s\S]{0,120}settings-info-card/);
        assert.match(settings.body.toString('utf8'), /\.settings-info-dependencies \{ display: grid; grid-template-columns: minmax\(0, 1fr\); gap: 2px;/);
        assert.match(settings.body.toString('utf8'), /\.settings-info-dependency \{[^}]*color: #928a83;/);
        assert.match(settings.body.toString('utf8'), /\.settings-info-runtime-section \+ \.settings-info-runtime-section::before \{[^}]*right: 16px; left: 16px;[^}]*height: 1px;/);
        assert.match(theme.body.toString('utf8'), /body\[data-theme-mode="light"\] \.settings-info-runtime-section \+ \.settings-info-runtime-section::before \{ background: #d4d4d4; \}/);
        assert.match(theme.body.toString('utf8'), /body\[data-theme-mode="dark"\] \.settings-info-runtime-section \+ \.settings-info-runtime-section::before \{ background: #404040; \}/);
        assert.match(settings.body.toString('utf8'), /\.settings-info-project-item \+ \.settings-info-project-item::before \{[^}]*right: 16px; left: 16px;[^}]*height: 1px;/);
        assert.doesNotMatch(settings.body.toString('utf8'), /Required dependencies/);
        assert.match(settings.body.toString('utf8'), /\.settings-version-value \{ font-family: "Streetsign Sans", sans-serif;/);
        assert.match(settings.body.toString('utf8'), /search-open/);
        assert.doesNotMatch(settings.body.toString('utf8'), /\.settings-search:focus\s*\{/);
        assert.match(settings.body.toString('utf8'), /\/icon\/model\.png/);
        assert.match(settings.body.toString('utf8'), /\['supportsVision', 'Vision'\]/);
        assert.match(settings.body.toString('utf8'), /\['supportsThinking', 'Thinking'\]/);
        assert.doesNotMatch(settings.body.toString('utf8'), /badgeIcon|settings-model-badge img/);
        assert.match(settings.body.toString('utf8'), /id: 'shortcuts', label: 'Shortcut', icon: '\/icon\/shortcut\.png'/);
        assert.match(settings.body.toString('utf8'), /id: 'information', label: 'About ZEUS', icon: '\/icon\/info\.png'/);
        assert.match(settings.body.toString('utf8'), /\.settings-nav\[data-section="information"\] img \{ filter: none; \}/);
        assert.doesNotMatch(settings.body.toString('utf8'), /Manage models detected from your local providers/);
        assert.doesNotMatch(settings.body.toString('utf8'), /Manage all models/);
        assert.doesNotMatch(settings.body.toString('utf8'), /deleteManagedModel|textContent = 'Delete'/);
        assert.doesNotMatch(settings.body.toString('utf8'), /External model detection|OpenAI-compatible/);
        assert.doesNotMatch(settings.body.toString('utf8'), /Quick model selection|settings-manage-status|Model list refreshed|Model settings saved/);
        assert.doesNotMatch(settings.body.toString('utf8'), /data-model-tab=/);

        const pageMarkup = page.body.toString('utf8');
        assert.match(pageMarkup, /<aside class="sidebar"[\s\S]*?<button class="sidebar-settings-button" id="settings-open-button"/);
        assert.doesNotMatch(pageMarkup, /<div class="chat-actions"[\s\S]*?id="settings-open-button"/);
        assert.match(pageMarkup, /id="attachment-image-viewer"/);
        assert.match(pageMarkup, /id="attachment-image-zoom"/);
        assert.match(pageMarkup, /data-zoom="25"/);
        assert.match(pageMarkup, /data-zoom="200"/);
        assert.doesNotMatch(pageMarkup, /attachment-image-floating-prompt|attachment-image-prompt-form|data-image-action=/);
        assert.match(pageMarkup, /id="attachment-file-preview"/);
        assert.match(pageMarkup, /id="attachment-file-copy"/);
        assert.match(pageMarkup, /id="attachment-file-scrollbar-horizontal"/);
        assert.match(pageMarkup, /id="attachment-file-resize-handle"/);

        const renderer = await requestRaw('/js/render.js');
        assert.equal(renderer.status, 200);
        const rendererText = renderer.body.toString('utf8');
        assert.match(rendererText, /from ['"]\.\/renderMath\.js['"]/);
        assert.match(rendererText, /from ['"]\.\/renderHTML\.js['"]/);

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

test('model catalog entries cannot be deleted through the WebUI API', async () => {
    const server = createWebUiServer({ db: {} });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    try {
        const response = await fetch(
            `http://127.0.0.1:${port}/api/model-catalog/ollama/local-model`,
            { method: 'DELETE' },
        );
        assert.equal(response.status, 404);
    } finally {
        await new Promise((resolve, reject) => server.close(error => (
            error ? reject(error) : resolve()
        )));
    }
});

test('external OpenAI-compatible model routes are no longer available', async () => {
    const server = createWebUiServer({ db: {} });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    try {
        for (const [path, method] of [
            ['/api/external-models', 'GET'],
            ['/api/external-models', 'POST'],
            ['/api/external-models/detect', 'POST'],
        ]) {
            const response = await fetch('http://127.0.0.1:' + port + path, { method });
            assert.equal(response.status, 404);
        }
    } finally {
        await new Promise((resolve, reject) => server.close(error => (
            error ? reject(error) : resolve()
        )));
    }
});
