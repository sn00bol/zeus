const WebSocket = require('ws');
const { randomUUID } = require('node:crypto');

function toWebSocketUrl(endpoint) {
    const url = new URL(endpoint);
    if (url.protocol === 'http:') url.protocol = 'ws:';
    else if (url.protocol === 'https:') url.protocol = 'wss:';
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
        throw new Error(`Unsupported bridge URL protocol: ${url.protocol}`);
    }
    url.pathname = '/ws';
    url.search = '';
    url.hash = '';
    return url;
}

function responseError(frame, label) {
    let data = {};
    try {
        data = JSON.parse(frame.body || '{}');
    } catch (error) {
        return new Error(`${label} returned invalid JSON: ${error.message}`);
    }
    return new Error(data.error || `${label} request failed (${frame.status}).`);
}

class BridgeWebSocketClient {
    constructor({ endpoint, headers = {}, label = 'Bridge', service = 'platform' }) {
        this.url = toWebSocketUrl(endpoint);
        this.headers = headers;
        this.label = label;
        this.service = service;
        this.socket = null;
        this.connecting = null;
        this.pending = new Map();
    }

    close() {
        this._failPending(new Error(`${this.label} WebSocket client closed.`));
        this.connecting = null;
        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }
    }

    request(path, { method = 'GET', body, timeoutMs = 10_000, signal } = {}) {
        return this._request(path, { method, body, timeoutMs, signal });
    }

    requestStream(path, {
        method = 'POST',
        body,
        timeoutMs = 600_000,
        signal,
        onChunk,
    } = {}) {
        return this._request(path, {
            method,
            body,
            timeoutMs,
            signal,
            onChunk,
        });
    }

    _request(path, { method, body, timeoutMs, signal, onChunk }) {
        if (signal && signal.aborted) {
            return Promise.reject(this._abortError());
        }

        const id = randomUUID();
        const requestPath = new URL(path, this.url);
        const frame = {
            id,
            service: this.service,
            method,
            path: `${requestPath.pathname}${requestPath.search}`,
            body,
        };

        return new Promise((resolve, reject) => {
            let settled = false;
            let timer;
            const cleanup = () => {
                if (timer) clearTimeout(timer);
                if (signal) signal.removeEventListener('abort', abort);
                this.pending.delete(id);
            };
            const finish = (error, result) => {
                if (settled) return;
                settled = true;
                cleanup();
                if (error) reject(error);
                else resolve(result);
            };
            const cancel = error => {
                const socket = this.socket;
                if (socket && socket.readyState === WebSocket.OPEN) {
                    socket.send(JSON.stringify({ type: 'cancel', id }));
                }
                finish(error);
            };
            const abort = () => cancel(this._abortError());
            const pending = {
                onChunk,
                finish,
                cancel,
                socket: null,
            };
            this.pending.set(id, pending);

            if (timeoutMs > 0) {
                timer = setTimeout(() => {
                    cancel(new Error(
                        `${this.label} request timed out after ${timeoutMs}ms.`,
                    ));
                }, timeoutMs);
            }
            if (signal) signal.addEventListener('abort', abort, { once: true });

            this._getSocket().then(socket => {
                if (settled) return;
                pending.socket = socket;
                socket.send(JSON.stringify(frame), error => {
                    if (error) finish(error);
                });
            }, finish);
        });
    }

    _getSocket() {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            return Promise.resolve(this.socket);
        }
        if (this.connecting) return this.connecting;

        const socket = new WebSocket(this.url, { headers: this.headers });
        this.socket = socket;
        this.connecting = new Promise((resolve, reject) => {
            let opened = false;
            const clearConnecting = () => {
                if (this.socket === socket) this.connecting = null;
            };
            socket.on('open', () => {
                opened = true;
                clearConnecting();
                resolve(socket);
            });
            socket.on('message', data => this._handleMessage(data));
            socket.on('error', error => {
                if (!opened) {
                    clearConnecting();
                    if (this.socket === socket) this.socket = null;
                    reject(error);
                }
            });
            socket.on('close', () => {
                clearConnecting();
                const error = new Error(`${this.label} WebSocket connection closed.`);
                this._failPending(error, socket);
                if (this.socket === socket) this.socket = null;
                if (!opened) reject(new Error(`${this.label} WebSocket connection closed before opening.`));
            });
        });
        return this.connecting;
    }

    _handleMessage(rawData) {
        let frame;
        try {
            frame = JSON.parse(rawData.toString('utf8'));
        } catch (error) {
            this._failPending(new Error(`${this.label} returned an invalid WebSocket frame: ${error.message}`));
            return;
        }
        if (!frame || typeof frame !== 'object') {
            this._failPending(new Error(`${this.label} returned an invalid WebSocket frame.`));
            return;
        }

        const pending = this.pending.get(frame.id);
        if (!pending) return;
        if (frame.type === 'response') {
            if (frame.status < 200 || frame.status >= 300) {
                pending.finish(responseError(frame, this.label));
                return;
            }
            try {
                pending.finish(null, JSON.parse(frame.body || 'null'));
            } catch (error) {
                pending.finish(new Error(`${this.label} returned invalid JSON: ${error.message}`));
            }
        } else if (frame.type === 'stream_start') {
            if (frame.status < 200 || frame.status >= 300) {
                pending.finish(new Error(`${this.label} stream failed (${frame.status}).`));
            }
        } else if (frame.type === 'stream_chunk') {
            try {
                if (typeof pending.onChunk === 'function') pending.onChunk(frame.body || '');
            } catch (error) {
                pending.cancel(error);
            }
        } else if (frame.type === 'stream_end') {
            pending.finish(null);
        } else if (frame.type === 'error') {
            pending.finish(new Error(frame.error || `${this.label} request failed.`));
        }
    }

    _failPending(error, socket) {
        for (const pending of [...this.pending.values()]) {
            if (
                socket === undefined
                || pending.socket === socket
                || (!pending.socket && this.socket === socket)
            ) {
                pending.finish(error);
            }
        }
    }

    _abortError() {
        const error = new Error('The model request was stopped.');
        error.name = 'AbortError';
        error.code = 'ABORT_ERR';
        return error;
    }
}

function createBridgeClient({ endpoint, token, label = 'Bridge', service = 'platform' }) {
    const headers = {};
    const normalizedToken = String(token || '').trim();
    if (normalizedToken) headers.Authorization = `Bearer ${normalizedToken}`;
    return new BridgeWebSocketClient({ endpoint, headers, label, service });
}

module.exports = { BridgeWebSocketClient, createBridgeClient, toWebSocketUrl };
