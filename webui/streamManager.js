const { randomUUID } = require('node:crypto');

const STREAM_TTL_MS = 30 * 60 * 1_000;
const MAX_STREAMS = 32;
const MAX_EVENTS_PER_STREAM = 8_192;
const MAX_BUFFER_BYTES_PER_STREAM = 2 * 1024 * 1024;
const MAX_PENDING_SUBSCRIBER_BYTES = 1024 * 1024;

class StreamManager {
    constructor({
        ttlMs = STREAM_TTL_MS,
        maxStreams = MAX_STREAMS,
        maxEventsPerStream = MAX_EVENTS_PER_STREAM,
        maxBufferBytesPerStream = MAX_BUFFER_BYTES_PER_STREAM,
    } = {}) {
        if (
            !Number.isFinite(ttlMs)
            || ttlMs <= 0
            || !Number.isSafeInteger(maxStreams)
            || maxStreams < 1
            || !Number.isSafeInteger(maxEventsPerStream)
            || maxEventsPerStream < 1
            || !Number.isSafeInteger(maxBufferBytesPerStream)
            || maxBufferBytesPerStream < 512
        ) {
            throw new RangeError('Stream capacity and retention limits must be positive.');
        }
        this.ttlMs = ttlMs;
        this.maxStreams = maxStreams;
        this.maxEventsPerStream = maxEventsPerStream;
        this.maxBufferBytesPerStream = maxBufferBytesPerStream;
        this.streams = new Map();
    }

    start(task, conversationId = null) {
        if (typeof task !== 'function') throw new TypeError('A stream task is required.');
        if (conversationId !== null && !String(conversationId).trim()) {
            throw new TypeError('A stream conversation ID cannot be empty.');
        }
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
            bufferedBytes: 0,
            completedAt: null,
            conversationId,
            controller: new AbortController(),
            cancelled: false,
        };
        const streamId = randomUUID();
        this.streams.set(streamId, stream);

        const publish = (type, data) => {
            if (stream.cancelled) return null;
            if (typeof type !== 'string' || !type) throw new TypeError('A stream event type is required.');
            const serialized = JSON.stringify(data);
            if (typeof serialized !== 'string') {
                throw new TypeError('Stream event data must be JSON serializable.');
            }
            const size = Buffer.byteLength(serialized, 'utf8');
            if (size > this.maxBufferBytesPerStream) {
                throw new RangeError('A stream event exceeds the replay-buffer limit.');
            }
            const event = { id: stream.nextEventId++, type, data, size };
            stream.events.push(event);
            stream.bufferedBytes += size;
            while (
                stream.events.length > this.maxEventsPerStream
                || stream.bufferedBytes > this.maxBufferBytesPerStream
            ) {
                const expired = stream.events.shift();
                stream.bufferedBytes -= expired.size;
            }
            for (const listener of stream.listeners) listener(event);
            return event;
        };

        publish('ui_control', { state: 'started' });
        stream.task = Promise.resolve()
            .then(() => task(publish, stream.controller.signal))
            .catch(error => {
                if (stream.cancelled) return;
                console.error('[WEBUI] Background chat stream failed:', error);
                const message = error instanceof Error && error.message
                    ? error.message.slice(0, 160)
                    : 'The model request failed.';
                publish('ui_control', { state: 'error', message });
                publish('stream_error', { message });
            })
            .finally(() => {
                if (stream.cancelled) return;
                if (!stream.events.some(event => (
                    event.type === 'done' || event.type === 'stream_error'
                    || event.type === 'stopped'
                ))) {
                    publish('stream_error', { message: 'The stream ended before completion.' });
                }
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

    cancel(streamId) {
        this.prune();
        const stream = this.streams.get(streamId);
        if (!stream || stream.completedAt !== null) return false;

        stream.cancelled = true;
        stream.completedAt = Date.now();
        stream.controller.abort();
        const event = { state: 'stopped' };
        const serialized = JSON.stringify(event);
        const size = Buffer.byteLength(serialized, 'utf8');
        const stoppedEvent = {
            id: stream.nextEventId++,
            type: 'stopped',
            data: event,
            size,
        };
        stream.events.push(stoppedEvent);
        stream.bufferedBytes += size;
        while (
            stream.events.length > this.maxEventsPerStream
            || stream.bufferedBytes > this.maxBufferBytesPerStream
        ) {
            const expired = stream.events.shift();
            stream.bufferedBytes -= expired.size;
        }
        for (const listener of stream.listeners) listener(stoppedEvent);
        return true;
    }

    subscribe(streamId, response, lastEventId = 0) {
        if (!Number.isSafeInteger(lastEventId) || lastEventId < 0) {
            throw new RangeError('The replay cursor must be a non-negative safe integer.');
        }
        const stream = this.streams.get(streamId);
        if (!stream) return false;
        let closed = false;
        let blocked = false;
        let pendingBytes = 0;
        let completeAfterPending = false;
        const pending = [];

        const detach = () => {
            if (closed) return;
            closed = true;
            stream.listeners.delete(writeEvent);
            pending.length = 0;
            pendingBytes = 0;
        };
        const endResponse = () => {
            detach();
            if (!response.destroyed && !response.writableEnded) response.end();
        };
        const writeFrame = event => {
            try {
                return response.write(
                    `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`,
                );
            } catch (error) {
                detach();
                response.destroy(error);
                return false;
            }
        };
        const flush = () => {
            blocked = false;
            while (!closed && pending.length) {
                const event = pending.shift();
                pendingBytes -= event.size;
                if (!writeFrame(event)) {
                    blocked = true;
                    response.once('drain', flush);
                    break;
                }
            }
            if (!closed && !blocked && pending.length === 0 && completeAfterPending) {
                endResponse();
            }
        };
        const writeEvent = event => {
            if (closed || response.destroyed || response.writableEnded) {
                detach();
                return;
            }
            const terminal = event.type === 'done'
                || event.type === 'stream_error'
                || event.type === 'stopped';
            if (blocked) {
                if (pendingBytes + event.size > MAX_PENDING_SUBSCRIBER_BYTES) {
                    detach();
                    response.destroy(new Error('The SSE subscriber exceeded its pending-data limit.'));
                    return;
                }
                pending.push(event);
                pendingBytes += event.size;
                if (terminal) {
                    stream.listeners.delete(writeEvent);
                    completeAfterPending = true;
                }
                return;
            }
            if (!writeFrame(event)) {
                blocked = true;
                response.once('drain', flush);
            }
            if (terminal) {
                stream.listeners.delete(writeEvent);
                completeAfterPending = true;
                endResponse();
            }
        };

        const firstEventId = stream.events[0]?.id;
        if (firstEventId !== undefined && lastEventId < firstEventId - 1) {
            writeEvent({
                id: firstEventId - 1,
                type: 'replay_gap',
                data: {
                    requestedAfter: lastEventId,
                    earliestAvailable: firstEventId,
                },
            });
        }
        for (const event of stream.events) {
            if (event.id > lastEventId) writeEvent(event);
            if (closed) break;
        }
        if (!closed && stream.completedAt === null) {
            stream.listeners.add(writeEvent);
            response.once('close', detach);
        } else if (!closed && pending.length) {
            completeAfterPending = true;
            response.once('close', detach);
        } else if (!closed) {
            endResponse();
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

module.exports = {
    MAX_BUFFER_BYTES_PER_STREAM,
    MAX_EVENTS_PER_STREAM,
    MAX_PENDING_SUBSCRIBER_BYTES,
    MAX_STREAMS,
    STREAM_TTL_MS,
    StreamManager,
};
