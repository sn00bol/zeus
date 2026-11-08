const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const ROOT = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });

const database = require('../core/database');
const { requestJson, requestSse } = require('./bridge');
const { StreamManager } = require('./streamManager');
const { createTitleGenerationService } = require('./js/title');

const PLATFORM = 'webui';
const DEFAULT_CONVERSATION_TITLE = 'New conversation';
const MAX_BODY_BYTES = 64 * 1024 * 1024; // 64 MB
const TEXT_ATTACHMENT_EXTENSIONS = new Set([
    'txt', 'md', 'markdown', 'rst', 'csv', 'tsv', 'json', 'jsonl', 'yaml', 'yml',
    'toml', 'xml', 'html', 'htm', 'css', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx',
    'py', 'pyi', 'java', 'c', 'h', 'cc', 'cpp', 'hpp', 'rs', 'go', 'rb', 'php',
    'sh', 'bash', 'zsh', 'sql', 'ps1', 'bat', 'cmd', 'diff', 'patch', 'ini',
    'conf', 'env', 'log', 'ipynb', 'mdx', 'vue', 'svelte', 'astro', 'kt', 'kts',
    'swift', 'dart', 'scala', 'sc', 'pl', 'pm', 'lua', 'r', 'm', 'mm', 'tex',
    'adoc', 'asciidoc', 'lock', 'tf', 'hcl', 'proto', 'graphql', 'gql', 'sol',
    'ex', 'exs', 'erl', 'hrl', 'hs', 'lhs', 'elm', 'clj', 'cljs', 'edn', 'fs',
    'fsx', 'cs', 'csx', 'vb', 'nix', 'fish', 'make', 'mk', 'gitignore',
    'gitattributes', 'editorconfig',
]);
const AVAILABLE_TOOLS = Object.freeze([
    {
        name: 'search',
        label: 'Search',
        description: 'Search the web for current facts, recent news, quick lookups, and online comparisons',
    },
]);

function modelScope(conversationId) {
    return `webui:conversation:${conversationId}`;
}

class HttpError extends Error {
    constructor(statusCode, message) {
        super(message);
        this.statusCode = statusCode;
    }
}

function sendJson(response, statusCode, payload) {
    const body = JSON.stringify(payload);
    response.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
    });
    response.end(body);
}

function getNodeDependencies() {
    const { dependencies } = JSON.parse(
        fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'),
    );
    return Object.keys(dependencies || {}).map(name => {
        const packagePath = path.join(ROOT, 'node_modules', name, 'package.json');
        const version = fs.existsSync(packagePath)
            ? JSON.parse(fs.readFileSync(packagePath, 'utf8')).version
            : 'Not installed';
        return { name, version: version || 'Unknown' };
    });
}

function validateConversationId(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
        throw new HttpError(400, 'conversationId must contain 1-128 letters, numbers, "_" or "-".');
    }
    return value;
}

function validateStreamId(value) {
    if (typeof value !== 'string'
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
        throw new HttpError(400, 'Invalid stream ID.');
    }
    return value;
}

function validateAttachments(value) {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > 20) {
        throw new HttpError(400, 'attachments must be an array of at most 20 files.');
    }
    return value.map((attachment, index) => {
        if (!attachment || typeof attachment !== 'object' || Array.isArray(attachment)
            || typeof attachment.name !== 'string' || !attachment.name.trim()
            || attachment.name.length > 255 || /[\\/\u0000-\u001f]/.test(attachment.name)) {
            throw new HttpError(400, `Attachment ${index + 1} has an invalid filename.`);
        }
        const name = attachment.name.trim();
        const type = typeof attachment.type === 'string' ? attachment.type.toLowerCase() : '';
        if (attachment.kind === 'image') {
            if (!/^image\/[a-z0-9.+-]+$/.test(type)
                || typeof attachment.data !== 'string') {
                throw new HttpError(400, `Attachment "${name}" is not a valid image.`);
            }
            const prefix = `data:${type};base64,`;
            if (!attachment.data.startsWith(prefix)) {
                throw new HttpError(400, `Attachment "${name}" has invalid image data.`);
            }
            const encoded = attachment.data.slice(prefix.length);
            if (!encoded || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
                throw new HttpError(400, `Attachment "${name}" has invalid image data.`);
            }
            return { kind: 'image', name, type, data: attachment.data };
        }
        const extension = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
        if (attachment.kind !== 'text' || !TEXT_ATTACHMENT_EXTENSIONS.has(extension)
            || typeof attachment.text !== 'string' || attachment.text.includes('\0')) {
            throw new HttpError(400, `Attachment "${name}" is not a supported text or code file.`);
        }
        return { kind: 'text', name, type, text: attachment.text };
    });
}

function providerMessageContent(content, attachments = []) {
    const textAttachments = attachments
        .filter(attachment => attachment.kind === 'text')
        .map(attachment => `\n\n--- Attached file: ${attachment.name} ---\n${attachment.text}\n--- End of ${attachment.name} ---`)
        .join('');
    const text = `${content}${textAttachments}`;
    const images = attachments.filter(attachment => attachment.kind === 'image');
    if (!images.length) return text;
    return [
        { type: 'text', text },
        ...images.map(attachment => ({
            type: 'image_url',
            image_url: { url: attachment.data },
        })),
    ];
}

async function readJson(request) {
    if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
        throw new HttpError(415, 'Content-Type must be application/json.');
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
            throw new HttpError(413, 'Request body is too large.');
        }
        chunks.push(chunk);
    }
    try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
            throw new Error('Expected a JSON object.');
        }
        return body;
    } catch (error) {
        throw new HttpError(400, `Invalid JSON body: ${error.message}`);
    }
}

function sendStatic(response, filePath, contentType) {
    const body = fs.readFileSync(filePath);
    sendContent(response, body, contentType);
}

function sendContent(response, body, contentType) {
    response.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': body.length,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-cache',
    });
    response.end(body);
}

function createWebUiServer({
    db = database,
    bridgeRequest = requestJson,
    bridgeSse = requestSse,
    streamManager = new StreamManager(),
    titleGenerator = createTitleGenerationService({ request: bridgeRequest }),
} = {}) {
    const bootId = randomUUID();
    const callBridge = async (route, options) => {
        try {
            return await bridgeRequest(route, options);
        } catch (error) {
            throw new HttpError(502, error.message || 'Inference bridge is unavailable.');
        }
    };
    const saveConversationTitle = async ({
        conversationId,
        title,
        titleSource,
        titleStatus,
    }) => {
        try {
            await db.pool.query(`
                UPDATE chat_sessions
                SET metadata = COALESCE(metadata, '{}'::jsonb)
                        || jsonb_build_object(
                            'title', $3::text,
                            'title_source', $4::text,
                            'title_status', $5::text
                        ),
                    updated_at = NOW()
                WHERE platform = $1
                  AND conversation_id = $2
                  AND metadata->>'title_status' = 'pending'
                  AND COALESCE(metadata->>'title_source', 'default') = 'default'
            `, [PLATFORM, conversationId, title, titleSource, titleStatus]);
        } catch (error) {
            console.error('[WEBUI] Could not save the conversation title:', error);
        }
    };
    const scheduleConversationTitle = ({ conversationId, prompt, provider, model }) => {
        const titleTask = Promise.resolve().then(async () => {
            let title;
            let titleSource = 'ai';
            let titleStatus = 'generated';
            try {
                title = await titleGenerator({ message: prompt, provider, model });
            } catch (error) {
                console.error('[WEBUI] Conversation title generation failed:', error);
                title = DEFAULT_CONVERSATION_TITLE;
                titleSource = 'default';
                titleStatus = 'failed';
            }
            await saveConversationTitle({
                conversationId,
                title,
                titleSource,
                titleStatus,
            });
        });
        titleTask.catch(error => {
            console.error('[WEBUI] Conversation title task failed:', error);
        });
    };

    return http.createServer(async (request, response) => {
        try {
            const url = new URL(request.url, 'http://localhost');
            if (request.method === 'GET' && url.pathname === '/health') {
                response.writeHead(200, {
                    'Content-Type': 'text/plain; charset=utf-8',
                    'Cache-Control': 'no-store',
                    'X-Content-Type-Options': 'nosniff',
                });
                response.end('ready');
                return;
            }
            if (request.method === 'GET' && url.pathname === '/version') {
                sendStatic(response, path.join(ROOT, 'version'), 'text/plain; charset=utf-8');
                return;
            }
            if (request.method === 'GET' && url.pathname === '/api/about') {
                const version = fs.readFileSync(path.join(ROOT, 'version'), 'utf8').trim();
                if (!version) throw new Error('The version file is empty.');

                const [pythonResult, searxngResult] = await Promise.allSettled([
                    callBridge('/about'),
                    fetch(`${(process.env.SEARXNG_URL || 'http://localhost:8080').replace(/\/+$/, '')}/`, {
                        headers: { 'X-Real-IP': '127.0.0.1' },
                        signal: AbortSignal.timeout(3_000),
                    }),
                ]);
                const searxngOnline = searxngResult.status === 'fulfilled'
                    && searxngResult.value.ok;
                if (!searxngOnline) {
                    console.warn('[WEBUI] Could not check SearXNG status.');
                }

                sendJson(response, 200, {
                    zeus: {
                        value: version,
                        status: 'online',
                        detail: 'Application version',
                    },
                    searxng: {
                        value: searxngOnline ? 'Available' : 'Unavailable',
                        status: searxngOnline ? 'online' : 'offline',
                        detail: 'SearXNG search service',
                    },
                    node: {
                        version: process.version,
                        status: 'online',
                        detail: 'WebUI runtime',
                        dependencies: getNodeDependencies(),
                    },
                    python: {
                        version: pythonResult.status === 'fulfilled'
                            ? pythonResult.value.python_version || 'Unavailable'
                            : 'Unavailable',
                        status: pythonResult.status === 'fulfilled' ? 'online' : 'offline',
                        detail: 'Inference runtime',
                        dependencies: pythonResult.status === 'fulfilled'
                            ? pythonResult.value.dependencies || []
                            : [],
                    },
                });
                return;
            }
            if (request.method === 'GET' && url.pathname === '/') {
                const version = fs.readFileSync(path.join(ROOT, 'version'), 'utf8').trim();
                if (!version) throw new Error('The version file is empty.');
                const escapedVersion = version.replace(/[&"<>]/g, character => ({
                    '&': '&amp;',
                    '"': '&quot;',
                    '<': '&lt;',
                    '>': '&gt;',
                })[character]);
                const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')
                    .replace('<meta name="zeus-boot-id" content="">', (
                        `<meta name="zeus-boot-id" content="${bootId}">`
                    ))
                    .replace('<meta name="zeus-version" content="">', (
                        `<meta name="zeus-version" content="${escapedVersion}">`
                    ));
                sendContent(response, Buffer.from(html, 'utf8'), 'text/html; charset=utf-8');
                return;
            }
            if (request.method === 'GET' && url.pathname === '/ZEUSbanner.png') {
                sendStatic(response, path.join(__dirname, 'ZEUSbanner.png'), 'image/png');
                return;
            }
            if (request.method === 'GET' && url.pathname === '/banner-background.png') {
                sendStatic(response, path.join(__dirname, 'banner-background.png'), 'image/png');
                return;
            }
            const projectDocMatch = url.pathname.match(/^\/project-docs\/(CONTRIBUTING|SECURITY|PRIVACY)\.md$/);
            if (request.method === 'GET' && projectDocMatch) {
                const fileName = `${projectDocMatch[1]}.md`;
                const markdown = fs.readFileSync(path.join(ROOT, fileName), 'utf8');
                sendContent(
                    response,
                    Buffer.from(markdown, 'utf8'),
                    'text/markdown; charset=utf-8',
                );
                return;
            }
            const fontMatch = url.pathname.match(/^\/font\/(Streetsign-Sans\.otf|Geist-(?:Regular|Bold|Italic|BoldItalic)\.ttf)$/);
            if (request.method === 'GET' && fontMatch) {
                const contentType = fontMatch[1].endsWith('.otf') ? 'font/otf' : 'font/ttf';
                sendStatic(
                    response,
                    path.join(__dirname, 'font', fontMatch[1]),
                    contentType,
                );
                return;
            }
            if (request.method === 'GET' && url.pathname === '/zeus.ico') {
                sendStatic(response, path.join(__dirname, 'zeus.ico'), 'image/x-icon');
                return;
            }
            const assetMatch = url.pathname.match(/^\/js\/(chat|render|renderMath|renderHTML|loading|stream|streamaddon|model|settings|sidebar|session|theme|scrollbar)\.js$/);
            if (request.method === 'GET' && assetMatch) {
                sendStatic(
                    response,
                    path.join(__dirname, 'js', `${assetMatch[1]}.js`),
                    'text/javascript; charset=utf-8',
                );
                return;
            }
            const vendorAssetMatch = url.pathname.match(
                /^\/vendor\/(katex\/(?:katex\.min\.(?:css|js)|fonts\/KaTeX_[A-Za-z0-9_-]+\.(?:woff2?|ttf))|dompurify\/purify\.min\.js|markdown-it\/markdown-it\.min\.js|task-lists\/markdown-it-task-lists\.min\.js)$/,
            );
            if (request.method === 'GET' && vendorAssetMatch) {
                const asset = vendorAssetMatch[1];
                let assetPath;
                if (asset.startsWith('katex/')) {
                    assetPath = path.join(
                        ROOT,
                        'node_modules',
                        'katex',
                        'dist',
                        asset.slice('katex/'.length),
                    );
                } else if (asset.startsWith('dompurify/')) {
                    assetPath = path.join(
                        ROOT,
                        'node_modules',
                        'dompurify',
                        'dist',
                        'purify.min.js',
                    );
                } else if (asset.startsWith('markdown-it/')) {
                    assetPath = path.join(
                        ROOT,
                        'node_modules',
                        'markdown-it',
                        'dist',
                        'markdown-it.min.js',
                    );
                } else {
                    assetPath = path.join(
                        ROOT,
                        'node_modules',
                        'markdown-it-task-lists',
                        'dist',
                        'markdown-it-task-lists.min.js',
                    );
                }

                const extension = path.extname(assetPath);
                const contentType = {
                    '.css': 'text/css; charset=utf-8',
                    '.js': 'text/javascript; charset=utf-8',
                    '.ttf': 'font/ttf',
                    '.woff': 'font/woff',
                    '.woff2': 'font/woff2',
                }[extension];
                if (contentType && fs.existsSync(assetPath)) {
                    sendStatic(response, assetPath, contentType);
                    return;
                }
            }
            const iconMatch = url.pathname.match(/^\/icon\/([a-zA-Z0-9_-]+)\.png$/);
            if (request.method === 'GET' && iconMatch) {
                const iconPath = path.join(__dirname, 'icon', `${iconMatch[1]}.png`);
                if (fs.existsSync(iconPath)) {
                    sendStatic(response, iconPath, 'image/png');
                    return;
                }
            }
            if (request.method === 'GET' && url.pathname === '/api/streams/active') {
                const conversationId = validateConversationId(url.searchParams.get('conversationId'));
                sendJson(response, 200, {
                    streamId: streamManager.activeForConversation(conversationId),
                });
                return;
            }
            if (request.method === 'GET' && url.pathname.startsWith('/api/streams/')) {
                const match = url.pathname.match(/^\/api\/streams\/([^/]+)\/events$/);
                if (!match) {
                    sendJson(response, 404, { error: 'Not found.' });
                    return;
                }
                const streamId = validateStreamId(match[1]);
                const rawLastEventId = request.headers['last-event-id'] || url.searchParams.get('after') || '0';
                const lastEventId = Number(rawLastEventId);
                if (!Number.isSafeInteger(lastEventId) || lastEventId < 0) {
                    throw new HttpError(400, 'Last-Event-ID must be a non-negative integer.');
                }
                if (!streamManager.has(streamId)) {
                    sendJson(response, 404, { error: 'Stream not found or expired.' });
                    return;
                }
                response.writeHead(200, {
                    'Content-Type': 'text/event-stream; charset=utf-8',
                    'Cache-Control': 'no-cache, no-transform',
                    Connection: 'keep-alive',
                    'X-Accel-Buffering': 'no',
                    'X-Content-Type-Options': 'nosniff',
                });
                response.flushHeaders();
                response.write('retry: 1500\n\n');
                const heartbeat = setInterval(() => {
                    if (!response.destroyed && !response.writableEnded) response.write(': keep-alive\n\n');
                }, 15_000);
                response.once('close', () => clearInterval(heartbeat));
                if (!streamManager.subscribe(streamId, response, lastEventId)) {
                    clearInterval(heartbeat);
                    response.end();
                }
                return;
            }
            if (request.method === 'GET' && url.pathname === '/api/status') {
                const [discovery, runtime] = await Promise.all([
                    callBridge('/models'),
                    callBridge('/status'),
                ]);
                sendJson(response, 200, {
                    models: Array.isArray(discovery.models) ? discovery.models : [],
                    model: runtime.model || null,
                });
                return;
            }
            if (request.method === 'GET' && url.pathname === '/api/tools') {
                sendJson(response, 200, { tools: AVAILABLE_TOOLS });
                return;
            }
            const modelControlMatch = url.pathname.match(/^\/api\/model-catalog\/([^/]+)\/([^/]+)$/);
            if (modelControlMatch && request.method === 'PATCH') {
                const provider = decodeURIComponent(modelControlMatch[1]);
                const modelId = decodeURIComponent(modelControlMatch[2]);
                if (!['ollama', 'lmstudio', 'llamacpp'].includes(provider)) {
                    throw new HttpError(400, 'Invalid built-in provider.');
                }
                if (!modelId || modelId.length > 256) {
                    throw new HttpError(400, 'Invalid model ID.');
                }
                const body = await readJson(request);
                const allowedFields = [['enabled', 'enabled']];
                const updates = allowedFields.filter(([input]) => body[input] !== undefined);
                if (!updates.length) {
                    throw new HttpError(400, 'Provide the enabled state to update.');
                }
                if (updates.some(([input]) => typeof body[input] !== 'boolean')) {
                    throw new HttpError(400, 'Model settings must be booleans.');
                }
                const values = [provider, modelId];
                const setters = updates.map(([input, column]) => {
                    values.push(body[input]);
                    return `${column} = $${values.length}`;
                });
                setters.push('updated_at = NOW()');
                await db.pool.query(`
                    INSERT INTO model_controls (provider_name, model_id)
                    VALUES ($1, $2)
                    ON CONFLICT (provider_name, model_id) DO NOTHING
                `, [provider, modelId]);
                await db.pool.query(`
                    UPDATE model_controls
                    SET ${setters.join(', ')}
                    WHERE provider_name = $1 AND model_id = $2
                `, values);
                if (body.enabled === false) {
                    await db.pool.query(
                        'DELETE FROM model_preferences WHERE provider_name = $1 AND model_id = $2',
                        [provider, modelId],
                    );
                }
                sendJson(response, 200, { saved: true });
                return;
            }
            if (request.method === 'GET' && url.pathname === '/api/model-catalog') {
                const discovery = await callBridge('/model-catalog');
                sendJson(response, 200, {
                    models: Array.isArray(discovery.models) ? discovery.models.map(model => ({
                        ...model,
                        provider_name: model.provider_name || model.provider,
                        baseUrl: model.base_url || model.baseUrl || '',
                        supportsVision: Boolean(model.supports_vision),
                        supportsThinking: Boolean(model.supports_thinking),
                    })) : [],
                });
                return;
            }
            if (request.method === 'GET' && url.pathname === '/api/models') {
                const conversationId = validateConversationId(url.searchParams.get('conversationId'));
                const [discovery, runtime, preference] = await Promise.all([
                    callBridge('/models'),
                    callBridge('/status'),
                    db.getModelPreference(modelScope(conversationId)),
                ]);
                sendJson(response, 200, {
                    models: Array.isArray(discovery.models) ? discovery.models : [],
                    preference: preference || null,
                    runtime: runtime.model || null,
                });
                return;
            }
            if (request.method === 'POST' && url.pathname === '/api/model-preference') {
                const body = await readJson(request);
                const conversationId = validateConversationId(body.conversationId);
                const provider = body.provider;
                const model = body.model;
                if (provider === 'auto' && model === 'auto') {
                    await db.pool.query('DELETE FROM model_preferences WHERE scope_id = $1', [
                        modelScope(conversationId),
                    ]);
                    sendJson(response, 200, { preference: null });
                    return;
                }
                if (typeof provider !== 'string' || typeof model !== 'string'
                    || !provider.trim() || !model.trim()) {
                    throw new HttpError(400, 'Select a valid provider and model, or automatic mode.');
                }
                const discovery = await callBridge('/models');
                const available = Array.isArray(discovery.models) && discovery.models.some(item => (
                    item.provider === provider && item.model === model
                ));
                if (!available) {
                    throw new HttpError(400, 'The selected model is not currently available.');
                }
                await db.setModelPreference(modelScope(conversationId), provider, model);
                sendJson(response, 200, { preference: { provider, model } });
                return;
            }
            if (request.method === 'GET' && url.pathname === '/api/history') {
                const conversationId = validateConversationId(url.searchParams.get('conversationId'));
                const messages = await db.getMessages({
                    platform: PLATFORM,
                    conversationId,
                    limit: 100,
                });
                sendJson(response, 200, { messages });
                return;
            }
            if (request.method === 'GET' && url.pathname === '/api/conversations') {
                const archivedFilter = url.searchParams.get('archived') === 'all'
                    ? null
                    : url.searchParams.get('archived') === 'true';
                const { rows } = await db.pool.query(`
                    SELECT chat_session.conversation_id,
                           chat_session.last_message_at,
                           chat_session.metadata,
                           COALESCE(
                               NULLIF(chat_session.metadata->>'title', ''),
                               (
                                   SELECT LEFT(message.payload->>'content', 72)
                                   FROM chat_messages AS message
                                   WHERE message.platform = chat_session.platform
                                     AND message.conversation_id = chat_session.conversation_id
                                     AND message.role = 'user'
                                   ORDER BY message.created_at ASC, message.id ASC
                                   LIMIT 1
                               ),
                               'New conversation'
                           ) AS preview
                    FROM chat_sessions AS chat_session
                    WHERE chat_session.platform = $1
                      AND chat_session.conversation_id NOT LIKE 'temp-%'
                      AND ($2::boolean IS NULL OR COALESCE((chat_session.metadata->>'archived')::boolean, FALSE) = $2)
                    ORDER BY COALESCE((chat_session.metadata->>'pinned')::boolean, FALSE) DESC,
                             COALESCE(chat_session.last_message_at, chat_session.updated_at) DESC
                    LIMIT 20
                `, [PLATFORM, archivedFilter]);
                sendJson(response, 200, {
                    conversations: rows
                        .filter(row => !row.conversation_id.startsWith('temp-'))
                        .map(row => ({
                            ...row,
                            is_title_generating: row.metadata?.title_status === 'pending',
                            is_generating: Boolean(
                                streamManager.activeForConversation(row.conversation_id)
                            ),
                        })),
                });
                return;
            }
            const conversationAction = url.pathname.match(/^\/api\/conversations\/([^/]+)$/);
            if (request.method === 'POST' && conversationAction) {
                const conversationId = validateConversationId(conversationAction[1]);
                const body = await readJson(request);
                const action = body.action;
                const session = await db.pool.query(`
                    SELECT metadata
                    FROM chat_sessions
                    WHERE platform = $1 AND conversation_id = $2
                `, [PLATFORM, conversationId]);
                if (session.rowCount === 0) throw new HttpError(404, 'Conversation not found.');
                const metadata = session.rows[0].metadata || {};

                if (action === 'rename') {
                    if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 100) {
                        throw new HttpError(400, 'Title must contain 1-100 characters.');
                    }
                    await db.pool.query(`
                        UPDATE chat_sessions
                        SET metadata = metadata || $3::jsonb, updated_at = NOW()
                        WHERE platform = $1 AND conversation_id = $2
                    `, [PLATFORM, conversationId, JSON.stringify({
                        title: body.title.trim(),
                        title_source: 'user',
                        title_status: 'generated',
                    })]);
                } else if (action === 'pin' || action === 'archive') {
                    const key = action === 'pin' ? 'pinned' : 'archived';
                    await db.pool.query(`
                        UPDATE chat_sessions
                        SET metadata = metadata || $3::jsonb, updated_at = NOW()
                        WHERE platform = $1 AND conversation_id = $2
                    `, [PLATFORM, conversationId, JSON.stringify({ [key]: Boolean(body.value) })]);
                } else if (action === 'delete') {
                    const client = await db.pool.connect();
                    try {
                        await client.query('BEGIN');
                        await client.query(
                            'DELETE FROM chat_messages WHERE platform = $1 AND conversation_id = $2',
                            [PLATFORM, conversationId],
                        );
                        await client.query(
                            'DELETE FROM conversation_memories WHERE platform = $1 AND conversation_id = $2',
                            [PLATFORM, conversationId],
                        );
                        await client.query(
                            'DELETE FROM chat_sessions WHERE platform = $1 AND conversation_id = $2',
                            [PLATFORM, conversationId],
                        );
                        await client.query(
                            'DELETE FROM model_preferences WHERE scope_id = $1',
                            [modelScope(conversationId)],
                        );
                        await client.query('COMMIT');
                    } catch (error) {
                        await client.query('ROLLBACK');
                        throw error;
                    } finally {
                        client.release();
                    }
                    sendJson(response, 200, { deleted: true });
                    return;
                } else {
                    throw new HttpError(400, 'Unsupported conversation action.');
                }
                sendJson(response, 200, { updated: true });
                return;
            }
            if (request.method === 'POST' && url.pathname === '/api/chat') {
                const body = await readJson(request);
                const conversationId = validateConversationId(body.conversationId);
                const attachments = validateAttachments(body.attachments);
                if (typeof body.message !== 'string'
                    || (!body.message.trim() && !attachments.length)) {
                    throw new HttpError(400, 'message or at least one attachment is required.');
                }
                const message = body.message.trim();
                const selectedTools = body.tools === undefined ? [] : body.tools;
                if (!Array.isArray(selectedTools)
                    || selectedTools.length > AVAILABLE_TOOLS.length
                    || new Set(selectedTools).size !== selectedTools.length
                    || selectedTools.some(tool => typeof tool !== 'string'
                        || !AVAILABLE_TOOLS.some(available => available.name === tool))) {
                    throw new HttpError(400, 'tools must contain only available tool names.');
                }

                const isTemporary = conversationId.startsWith('temp-')
                    || Boolean(body.isTemporary || body.temporary);
                const userId = `webui-${conversationId}`;
                let history;
                let titlePrompt = null;
                if (isTemporary) {
                    if (Array.isArray(body.messages) && body.messages.length > 0) {
                        history = body.messages
                            .filter(m => m && (m.role === 'user' || m.role === 'assistant')
                                && typeof m.content === 'string')
                            .map(item => ({
                                ...item,
                                attachments: validateAttachments(item.attachments),
                            }));
                    } else {
                        history = [{ role: 'user', content: message, attachments }];
                    }
                } else {
                    await db.appendMessage({
                        platform: PLATFORM,
                        conversation_id: conversationId,
                        message_id: randomUUID(),
                        role: 'user',
                        content: message || 'Please analyze the attached file(s).',
                        tools: selectedTools,
                        attachments,
                        user_id: userId,
                        timestamp: new Date().toISOString(),
                    });

                    const titleClaim = await db.pool.query(`
                        WITH first_user_message AS (
                            SELECT payload->>'content' AS prompt
                            FROM chat_messages
                            WHERE platform = $1
                              AND conversation_id = $2
                              AND role = 'user'
                            ORDER BY created_at ASC, id ASC
                            LIMIT 1
                        )
                        UPDATE chat_sessions AS session
                        SET metadata = COALESCE(session.metadata, '{}'::jsonb)
                                || jsonb_build_object(
                                    'title', 'New conversation',
                                    'title_source', 'default',
                                    'title_status', 'pending'
                                ),
                            updated_at = NOW()
                        FROM first_user_message
                        WHERE session.platform = $1
                          AND session.conversation_id = $2
                          AND COALESCE(session.metadata->>'title', '') = ''
                          AND COALESCE(session.metadata->>'title_source', 'default') = 'default'
                        RETURNING first_user_message.prompt
                    `, [PLATFORM, conversationId]);
                    titlePrompt = titleClaim.rows?.[0]?.prompt || null;

                    history = await db.getMessages({
                        platform: PLATFORM,
                        conversationId,
                        limit: 100,
                    });
                }
                const latestUserMessage = [...history].reverse()
                    .find(item => item.role === 'user');
                if (latestUserMessage) {
                    latestUserMessage.attachments = attachments;
                    if (!latestUserMessage.content) {
                        latestUserMessage.content = 'Please analyze the attached file(s).';
                    }
                }
                const providerMessages = history.map(({ role, content, attachments: messageAttachments }) => ({
                    role,
                    content: role === 'user'
                        ? providerMessageContent(content, validateAttachments(messageAttachments))
                        : content,
                }));
                const preference = await db.getModelPreference(modelScope(conversationId));
                const streamId = streamManager.start(async publish => {
                    publish('ui_control', { state: 'thinking' });
                    let result;
                    try {
                        result = await bridgeSse('/infer', {
                            method: 'POST',
                            timeoutMs: 600_000,
                            body: {
                                stream: true,
                                provider: preference?.provider,
                                model: preference?.model,
                                platform: PLATFORM,
                                think: body.think,
                                tools: selectedTools,
                                session: {
                                    platform: PLATFORM,
                                    conversation_id: conversationId,
                                    user_id: userId,
                                },
                                messages: providerMessages,
                            },
                            onEvent(type, data) {
                                if (type === 'thinking' && data.text) {
                                    publish('thinking', { text: data.text });
                                } else if (type === 'delta' && data.text) {
                                    publish('delta', { text: data.text });
                                }
                            },
                        });
                    } catch (error) {
                        if (titlePrompt) {
                            saveConversationTitle({
                                conversationId,
                                title: DEFAULT_CONVERSATION_TITLE,
                                titleSource: 'default',
                                titleStatus: 'failed',
                            });
                        }
                        throw error;
                    }
                    if (titlePrompt) {
                        scheduleConversationTitle({
                            conversationId,
                            prompt: titlePrompt,
                            provider: result.provider,
                            model: result.model,
                        });
                    }
                    const assistantMessage = {
                        platform: PLATFORM,
                        conversation_id: conversationId,
                        message_id: randomUUID(),
                        role: 'assistant',
                        content: String(result.content || ''),
                        thinking: String(result.thinking || ''),
                        provider: result.provider,
                        model: result.model,
                        sources: Array.isArray(result.sources) ? result.sources : [],
                        user_id: userId,
                        usage: {
                            prompt_tokens: Number(result.prompt_tokens) || 0,
                            completion_tokens: Number(result.completion_tokens) || 0,
                            context_length: Number(result.context_length) || null,
                        },
                        timestamp: new Date().toISOString(),
                    };
                    if (!isTemporary) {
                        await db.appendMessage(assistantMessage);
                    }
                    publish('streamaddon', {
                        provider: result.provider,
                        model: result.model,
                        prompt_tokens: assistantMessage.usage.prompt_tokens,
                        completion_tokens: assistantMessage.usage.completion_tokens,
                        context_length: assistantMessage.usage.context_length,
                        sources: assistantMessage.sources,
                    });
                    publish('ui_control', { state: 'complete' });
                    publish('done', { message: assistantMessage });
                });
                sendJson(response, 202, { streamId });
                return;
            }
            sendJson(response, 404, { error: 'Not found.' });
        } catch (error) {
            if (response.headersSent || response.destroyed) {
                response.destroy();
                return;
            }
            const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
            if (statusCode >= 500) {
                console.error('[WEBUI] Request failed:', error);
            }
            sendJson(response, statusCode, {
                error: statusCode === 500 ? 'An internal server error occurred.' : error.message,
            });
        }
    });
}

function pythonExecutable() {
    const configured = process.env.PYTHON_EXECUTABLE || process.env.PYTHON;
    if (configured) return configured;
    const virtualEnvPython = process.platform === 'win32'
        ? path.join(ROOT, '.venv', 'Scripts', 'python.exe')
        : path.join(ROOT, '.venv', 'bin', 'python');
    return fs.existsSync(virtualEnvPython) ? virtualEnvPython : 'python';
}

async function ensureBridge() {
    const webUiPort = Number(process.env.WEBUI_PORT) || 3000;
    const bridgePort = Number(process.env.WEBUI_BRIDGE_PORT) || 5002;
    if (!process.env.WEBUI_BRIDGE_URL && webUiPort === bridgePort) {
        throw new Error('WEBUI_PORT and WEBUI_BRIDGE_PORT must be different.');
    }
    try {
        await requestJson('/health', { timeoutMs: 1_000 });
        return null;
    } catch (error) {
        if (process.env.WEBUI_BRIDGE_URL) {
            throw new Error(`Configured WebUI inference bridge is unavailable: ${error.message}`);
        }
        const child = spawn(pythonExecutable(), ['-m', 'src.webui_bridge'], {
            cwd: ROOT,
            env: process.env,
            stdio: 'inherit',
        });
        let startupError;
        child.on('error', error => { startupError = error; });

        const deadline = Date.now() + 30_000;
        while (Date.now() < deadline) {
            if (startupError) throw startupError;
            if (child.exitCode !== null) {
                throw new Error(`WebUI inference bridge exited during startup (code ${child.exitCode}).`);
            }
            try {
                await requestJson('/health', { timeoutMs: 1_000 });
                return child;
            } catch {
                await new Promise(resolve => setTimeout(resolve, 250));
            }
        }
        child.kill();
        throw new Error('WebUI inference bridge did not become ready within 30 seconds.');
    }
}

async function start() {
    await database.init();
    const bridgeProcess = await ensureBridge();
    const server = createWebUiServer();
    const host = process.env.WEBUI_HOST || '127.0.0.1';
    const port = Number(process.env.WEBUI_PORT) || 3000;
    server.listen(port, host, () => {
        console.log(`[WEBUI] Open http://localhost:${port}`);
    });

    let shuttingDown = false;
    const shutdown = () => {
        if (shuttingDown) return;
        shuttingDown = true;
        server.close(async error => {
            if (error) console.error('[WEBUI] Could not close HTTP server:', error);
            if (bridgeProcess && bridgeProcess.exitCode === null) bridgeProcess.kill();
            try {
                await database.close();
            } catch (closeError) {
                console.error('[WEBUI] Could not close database pool:', closeError);
                process.exitCode = 1;
            }
        });
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
}

if (require.main === module) {
    start().catch(async error => {
        console.error('[WEBUI] Startup failed:', error);
        try {
            await database.close();
        } catch (closeError) {
            console.error('[WEBUI] Could not close database pool:', closeError);
        }
        process.exitCode = 1;
    });
}

module.exports = {
    createWebUiServer,
    validateConversationId,
};
