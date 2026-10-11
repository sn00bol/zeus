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

const PLATFORM = 'webui';
const MAX_BODY_BYTES = 64 * 1024 * 1024; // 64 MB
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

function conversationTitleFromPrompt(prompt) {
    const normalized = prompt
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^[\s"'`]+|[\s"'`]+$/g, '');
    if (normalized.length <= 56) {
        return normalized.charAt(0).toLocaleUpperCase() + normalized.slice(1);
    }

    const opening = normalized
        .split(/(?<=[.!?。！？])\s+/u, 1)[0]
        .replace(/^(?:(?:please\s+)?(?:help me|can you|could you|i want to)\s+|(?:hãy\s+)?(?:giúp tôi|giúp mình|mình muốn|tôi muốn)\s+)/i, '');
    const concise = opening.split(' ').slice(0, 8).join(' ');
    return `${concise.slice(0, 56).replace(/[\s,;:.-]+$/g, '')}…`;
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
    streamManager = new StreamManager(),
} = {}) {
    const bootId = randomUUID();
    const callBridge = async (route, options) => {
        try {
            return await bridgeRequest(route, options);
        } catch (error) {
            throw new HttpError(502, error.message || 'Inference bridge is unavailable.');
        }
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
            if (request.method === 'GET' && url.pathname === '/') {
                const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')
                    .replace('<meta name="zeus-boot-id" content="">', (
                        `<meta name="zeus-boot-id" content="${bootId}">`
                    ));
                sendContent(response, Buffer.from(html, 'utf8'), 'text/html; charset=utf-8');
                return;
            }
            if (request.method === 'GET' && url.pathname === '/ZEUSbanner.png') {
                sendStatic(response, path.join(__dirname, 'ZEUSbanner.png'), 'image/png');
                return;
            }
            if (request.method === 'GET' && url.pathname === '/zeus.ico') {
                sendStatic(response, path.join(__dirname, 'zeus.ico'), 'image/x-icon');
                return;
            }
            const assetMatch = url.pathname.match(/^\/js\/(chat|render|renderMath|renderHTML|loading|stream|streamaddon|model|sidebar|session|theme)\.js$/);
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
                      AND ($2::boolean IS NULL OR COALESCE((chat_session.metadata->>'archived')::boolean, FALSE) = $2)
                    ORDER BY COALESCE((chat_session.metadata->>'pinned')::boolean, FALSE) DESC,
                             COALESCE(chat_session.last_message_at, chat_session.updated_at) DESC
                    LIMIT 20
                `, [PLATFORM, archivedFilter]);
                sendJson(response, 200, {
                    conversations: rows.map(row => ({
                        ...row,
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
                    `, [PLATFORM, conversationId, JSON.stringify({ title: body.title.trim() })]);
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
                if (typeof body.message !== 'string' || !body.message.trim()) {
                    throw new HttpError(400, 'message must not be empty.');
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

                const userId = `webui-${conversationId}`;
                await db.appendMessage({
                    platform: PLATFORM,
                    conversation_id: conversationId,
                    message_id: randomUUID(),
                    role: 'user',
                    content: message,
                    user_id: userId,
                    timestamp: new Date().toISOString(),
                });

                const history = await db.getMessages({
                    platform: PLATFORM,
                    conversationId,
                    limit: 100,
                });
                const preference = await db.getModelPreference(modelScope(conversationId));
                const isFirstMessage = history.filter(item => item.role === 'user').length === 1;
                if (isFirstMessage) {
                    const title = conversationTitleFromPrompt(message);
                    await db.pool.query(`
                        UPDATE chat_sessions
                        SET metadata = (
                                COALESCE(metadata, '{}'::jsonb)
                                - 'title_pending_boot'
                                - 'title_generation_requested'
                            ) || CASE WHEN COALESCE(metadata->>'title', '') = ''
                                THEN jsonb_build_object('title', $3::text)
                                ELSE '{}'::jsonb END,
                            updated_at = NOW()
                        WHERE platform = $1
                          AND conversation_id = $2
                    `, [PLATFORM, conversationId, title]);
                }
                const streamId = streamManager.start(async publish => {
                    publish('ui_control', { state: 'thinking' });
                    const result = await requestSse('/infer', {
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
                            messages: history.map(({ role, content }) => ({ role, content })),
                        },
                        onEvent(type, data) {
                            if (type === 'thinking' && data.text) {
                                publish('thinking', { text: data.text });
                            } else if (type === 'delta' && data.text) {
                                publish('delta', { text: data.text });
                            }
                        },
                    });
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
                    await db.appendMessage(assistantMessage);
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
    conversationTitleFromPrompt,
    createWebUiServer,
    validateConversationId,
};
