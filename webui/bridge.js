const { createBridgeClient } = require('../core/websocket');

const bridge = createBridgeClient({
    endpoint: process.env.WEBUI_BRIDGE_URL
        || `http://127.0.0.1:${process.env.BRIDGE_PORT || process.env.WEBUI_BRIDGE_PORT || '5002'}`,
    token: process.env.BRIDGE_TOKEN,
    label: 'WebUI bridge',
    service: 'webui',
});

function requestJson(path, options) {
    return bridge.request(path, options);
}

function requestSse(path, {
    method = 'POST',
    body,
    timeoutMs = 600_000,
    onEvent,
    signal,
} = {}) {
    let buffer = '';
    let eventName = 'message';
    let result;

    return bridge.requestStream(path, {
        method,
        body,
        timeoutMs,
        signal,
        onChunk(chunk) {
            buffer += chunk;
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const rawLine of lines) {
                const line = rawLine.replace(/\r$/, '');
                if (!line) continue;
                if (line.startsWith('event:')) {
                    eventName = line.slice(6).trim() || 'message';
                    continue;
                }
                if (!line.startsWith('data:')) continue;

                let data;
                try {
                    data = JSON.parse(line.slice(5).trim());
                } catch (error) {
                    throw new Error(`WebUI bridge returned invalid stream data: ${error.message}`);
                }
                const type = eventName;
                eventName = 'message';
                if (type === 'error') {
                    throw new Error(data.error || 'The model request failed.');
                }
                if (typeof onEvent === 'function') onEvent(type, data);
                if (type === 'done') result = data;
            }
        },
    }).then(() => {
        if (result === undefined) {
            throw new Error('The inference stream closed before it completed.');
        }
        return result;
    });
}

module.exports = {
    requestJson,
    requestSse,
    close: () => bridge.close(),
};
