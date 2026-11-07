const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const http = require('node:http');
const test = require('node:test');

const { conversationTitleFromPrompt, createWebUiServer } = require('../webui/app');
const { StreamManager } = require('../webui/streamManager');

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

test('conversation titles are immediate and concise for long prompts', () => {
    assert.equal(conversationTitleFromPrompt('hỏi thời tiết hôm nay'), 'Hỏi thời tiết hôm nay');
    const title = conversationTitleFromPrompt(
        'Please help me plan a detailed migration from PostgreSQL to SQLite while preserving all existing user data and indexes.',
    );
    assert.match(title, /PostgreSQL to SQLite/);
    assert.ok(title.length <= 57);
    assert.ok(title.endsWith('…'));
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
            return { python_version: '3.13.4' };
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
        assert.match(page.body.toString('utf8'), /src="\/vendor\/markdown-it\/markdown-it\.min\.js"/);
        assert.match(page.body.toString('utf8'), /src="\/vendor\/task-lists\/markdown-it-task-lists\.min\.js"/);
        assert.doesNotMatch(page.body.toString('utf8'), /cdn\.jsdelivr\.net/);
        const currentBootId = page.body.toString('utf8').match(
            /<meta name="zeus-boot-id" content="([^"]+)">/,
        )[1];

        const theme = await requestRaw('/js/theme.js');
        assert.equal(theme.status, 200);
        assert.match(theme.body.toString('utf8'), /--accent:\s*#fb923c/);
        assert.match(theme.body.toString('utf8'), /background:\s*#100d0b/);
        assert.match(theme.body.toString('utf8'), /\.chat-scrollbar \{[^}]*width:\s*30px;[^}]*pointer-events:\s*auto;/);
        assert.match(theme.body.toString('utf8'), /\.chat-scrollbar::before \{[^}]*pointer-events:\s*none;/);
        assert.match(theme.body.toString('utf8'), /\.chat-scrollbar:hover \{ opacity:\s*\.55; \}/);
        assert.doesNotMatch(theme.body.toString('utf8'), /#a78bfa|#c4b5fd/);

        for (const assetPath of [
            '/js/renderMath.js',
            '/js/renderHTML.js',
            '/js/settings.js',
            '/js/scrollbar.js',
            '/icon/model.png',
            '/icon/search.png',
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
        ]) {
            const asset = await requestRaw(assetPath);
            assert.equal(asset.status, 200, `${assetPath} should be served`);
            assert.ok(asset.body.length > 0, `${assetPath} should not be empty`);
        }

        const settings = await requestRaw('/js/settings.js');
        assert.match(settings.body.toString('utf8'), /Model Manager/);
        assert.match(settings.body.toString('utf8'), /data-page="shortcuts" hidden/);
        assert.match(settings.body.toString('utf8'), /<h2 class="settings-section-title">Model Manager<\/h2>/);
        assert.match(settings.body.toString('utf8'), /settings-catalog-refresh/);
        assert.match(settings.body.toString('utf8'), /class="settings-search"/);
        assert.match(settings.body.toString('utf8'), /settings-search-results chat-scroll/);
        assert.match(settings.body.toString('utf8'), /aria-label="Settings page scroll position"/);
        assert.match(settings.body.toString('utf8'), /settings-doc-dialog-content chat-scroll/);
        assert.match(settings.body.toString('utf8'), /class="chat-scrollbar"/);
        assert.doesNotMatch(settings.body.toString('utf8'), /\.settings-doc-scrollbar/);
        assert.match(settings.body.toString('utf8'), /label: 'About ZEUS', keywords: 'about zeus version information'/);
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
