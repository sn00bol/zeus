const http = require('node:http');
const https = require('node:https');

function requestJson(path, { method = 'GET', body, timeoutMs = 10_000 } = {}) {
    const bridgeUrl = new URL(
        process.env.WEBUI_BRIDGE_URL
            || `http://127.0.0.1:${process.env.WEBUI_BRIDGE_PORT || '5002'}`,
    );
    const transport = bridgeUrl.protocol === 'https:' ? https : http;
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));

    return new Promise((resolve, reject) => {
        const request = transport.request(new URL(path, bridgeUrl), {
            method,
            headers: payload
                ? {
                    'Content-Type': 'application/json',
                    'Content-Length': payload.length,
                }
                : undefined,
        }, response => {
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('error', reject);
            response.on('end', () => {
                let data;
                try {
                    data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                } catch (error) {
                    reject(new Error(`WebUI bridge returned invalid JSON: ${error.message}`));
                    return;
                }

                if (response.statusCode < 200 || response.statusCode >= 300) {
                    reject(new Error(data.error || `WebUI bridge request failed (${response.statusCode}).`));
                    return;
                }
                resolve(data);
            });
        });

        request.setTimeout(timeoutMs, () => {
            request.destroy(new Error(`WebUI bridge request timed out after ${timeoutMs}ms.`));
        });
        request.on('error', reject);
        if (payload) request.write(payload);
        request.end();
    });
}

function requestSse(path, {
    method = 'POST',
    body,
    timeoutMs = 600_000,
    onEvent,
    signal,
} = {}) {
    const bridgeUrl = new URL(
        process.env.WEBUI_BRIDGE_URL
            || `http://127.0.0.1:${process.env.WEBUI_BRIDGE_PORT || '5002'}`,
    );
    const transport = bridgeUrl.protocol === 'https:' ? https : http;
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));

    return new Promise((resolve, reject) => {
        const request = transport.request(new URL(path, bridgeUrl), {
            method,
            headers: payload
                ? {
                    'Content-Type': 'application/json',
                    'Accept': 'text/event-stream',
                    'Content-Length': payload.length,
                }
                : { Accept: 'text/event-stream' },
        }, response => {
            if (response.statusCode < 200 || response.statusCode >= 300) {
                const chunks = [];
                response.on('data', chunk => chunks.push(chunk));
                response.on('error', reject);
                response.on('end', () => {
                    let data = {};
                    try {
                        data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                    } catch {
                        data = {};
                    }
                    reject(new Error(data.error || `WebUI bridge request failed (${response.statusCode}).`));
                });
                return;
            }

            let buffer = '';
            let eventName = 'message';
            let settled = false;
            const finish = (error, result) => {
                if (settled) return;
                settled = true;
                if (error) reject(error);
                else resolve(result);
            };

            response.on('data', chunk => {
                buffer += chunk.toString('utf8');
                const parts = buffer.split('\n');
                buffer = parts.pop() ?? '';
                for (const rawLine of parts) {
                    const line = rawLine.replace(/\r$/, '');
                    if (!line) {
                        continue;
                    }
                    if (line.startsWith('event:')) {
                        eventName = line.slice(6).trim() || 'message';
                        continue;
                    }
                    if (!line.startsWith('data:')) {
                        continue;
                    }
                    const payloadText = line.slice(5).trim();
                    let data;
                    try {
                        data = JSON.parse(payloadText);
                    } catch (error) {
                        finish(new Error(`WebUI bridge returned invalid stream data: ${error.message}`));
                        request.destroy();
                        return;
                    }
                    const type = eventName;
                    eventName = 'message';
                    if (type === 'error') {
                        finish(new Error(data.error || 'The model request failed.'));
                        return;
                    }
                    if (typeof onEvent === 'function') onEvent(type, data);
                    if (type === 'done') finish(null, data);
                }
            });
            response.on('error', error => finish(error));
            response.on('end', () => {
                if (!settled) {
                    finish(new Error('The inference stream closed before it completed.'));
                }
            });
        });

        if (timeoutMs > 0) {
            request.setTimeout(timeoutMs, () => {
                request.destroy(new Error(`WebUI bridge request timed out after ${timeoutMs}ms.`));
            });
        }
        request.on('error', reject);
        if (signal) {
            const abort = () => {
                const error = new Error('The model request was stopped.');
                error.name = 'AbortError';
                error.code = 'ABORT_ERR';
                request.destroy(error);
            };
            if (signal.aborted) {
                abort();
                return;
            } else {
                signal.addEventListener('abort', abort, { once: true });
                request.once('close', () => signal.removeEventListener('abort', abort));
            }
        }
        if (payload) request.write(payload);
        request.end();
    });
}

module.exports = { requestJson, requestSse };
