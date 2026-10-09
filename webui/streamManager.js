const { randomUUID } = require('node:crypto');

const STREAM_TTL_MS = 30 * 60 * 1_000;
const MAX_STREAMS = 32;

class StreamManager {
    constructor({ ttlMs = STREAM_TTL_MS, maxStreams = MAX_STREAMS } = {}) {
        this.ttlMs = ttlMs;
        this.maxStreams = maxStreams;
        this.streams = new Map();
    }

    start(task, conversationId = null) {
        this.prune();
        if (this.streams.size >= this.maxStreams) {
            const completed = [...this.streams.entries()]
                .filter(([, stream]) => stream.completedAt !== null)
                .sort((left, right) => left[1].completedAt - right[1].completedAt);
            if (completed.length === 0) {
                const error = new Error('The WebUI is handling too many chat streams. Try again shortly.');
                error.statusCode = 503;
                throw error;
            }
            this.streams.delete(completed[0][0]);
        }

        const stream = {
            events: [],
            listeners: new Set(),
            nextEventId: 1,
            completedAt: null,
            tail: '',
            conversationId,
        };
        const streamId = randomUUID();
        this.streams.set(streamId, stream);

        const publish = (type, data) => {
            const event = { id: stream.nextEventId++, type, data };
            stream.events.push(event);
            for (const listener of stream.listeners) listener(event);
            return event;
        };

        publish('ui_control', { state: 'started' });
        stream.task = Promise.resolve()
            .then(() => task(publish))
            .catch(error => {
                console.error('[WEBUI] Background chat stream failed:', error);
                publish('ui_control', { state: 'error', message: error.message });
                publish('stream_error', { message: error.message || 'The model request failed.' });
            })
            .finally(() => {
                stream.completedAt = Date.now();
            });
        return streamId;
    }

    has(streamId) {
        this.prune();
        return this.streams.has(streamId);
    }

    activeForConversation(conversationId) {
        this.prune();
        for (const [streamId, stream] of this.streams) {
            if (stream.conversationId === conversationId && stream.completedAt === null) {
                return streamId;
            }
        }
        return null;
    }

    subscribe(streamId, response, lastEventId = 0) {
        const stream = this.streams.get(streamId);
        if (!stream) return false;
        let closed = false;

        const writeEvent = event => {
            if (closed || response.destroyed || response.writableEnded) return;
            response.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
            if (event.type === 'done' || event.type === 'stream_error') {
                closed = true;
                stream.listeners.delete(writeEvent);
                response.end();
            }
        };

        for (const event of stream.events) {
            if (event.id > lastEventId) writeEvent(event);
            if (closed) break;
        }
        if (!closed && stream.completedAt === null) {
            stream.listeners.add(writeEvent);
            response.once('close', () => {
                closed = true;
                stream.listeners.delete(writeEvent);
            });
        } else if (!closed) {
            response.end();
        }
        return true;
    }

    prune(now = Date.now()) {
        for (const [streamId, stream] of this.streams) {
            if (stream.completedAt !== null && now - stream.completedAt >= this.ttlMs) {
                this.streams.delete(streamId);
            }
        }
    }
}

module.exports = { StreamManager };
