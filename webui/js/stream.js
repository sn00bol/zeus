function parseEvent(event) {
    try {
        return JSON.parse(event.data);
    } catch (error) {
        throw new Error(`Invalid ${event.type} stream event: ${error.message}`);
    }
}

export async function startChatStream({ conversationId, message }) {
    const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, message }),
    });
    const start = await response.json();
    if (!response.ok) throw new Error(start.error || `Chat request failed (${response.status}).`);
    return start.streamId;
}

export function watchChatStream({ streamId, onEvent }) {
    return new Promise((resolve, reject) => {
        const source = new EventSource(`/api/streams/${encodeURIComponent(streamId)}/events`);
        let settled = false;

        const stop = () => {
            source.close();
            settled = true;
        };
        const listen = (eventName, handler) => {
            source.addEventListener(eventName, event => {
                if (settled) return;
                try {
                    handler(parseEvent(event));
                } catch (error) {
                    stop();
                    reject(error);
                }
            });
        };

        listen('ui_control', data => onEvent('ui_control', data));
        listen('delta', data => onEvent('delta', data));
        listen('streamaddon', data => onEvent('streamaddon', data));
        listen('done', data => {
            onEvent('done', data);
            stop();
            resolve(data);
        });
        listen('stream_error', data => {
            onEvent('stream_error', data);
            stop();
            reject(new Error(data.message || 'The model request failed.'));
        });
        source.onerror = () => {
            if (source.readyState === EventSource.CLOSED && !settled) {
                stop();
                reject(new Error('The response stream was closed before it completed.'));
            }
        };

        onEvent('stream_started', { streamId });
    });
}