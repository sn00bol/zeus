const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function normalizeMessage(entry, fallbackPlatform) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new TypeError('Each history entry must be a JSON object.');
    }
    const platform = String(entry.platform || fallbackPlatform || '');
    const conversationId = String(entry.conversation_id || '');
    const role = String(entry.role || '');
    if (!platform || !conversationId || !['system', 'user', 'assistant'].includes(role)) {
        throw new TypeError('Each entry needs platform, conversation_id, and a valid role.');
    }
    const timestamp = entry.timestamp ? new Date(entry.timestamp) : new Date();
    if (Number.isNaN(timestamp.getTime())) {
        throw new TypeError('History timestamps must be valid date values.');
    }

    return {
        ...entry,
        platform,
        conversation_id: conversationId,
        message_id: String(entry.message_id || randomUUID()),
        role,
        content: String(entry.content || ''),
        timestamp: timestamp.toISOString(),
    };
}

async function appendMessage(pool, entry) {
    const payload = normalizeMessage(entry);
    const metadata = {};
    for (const key of ['channel_id', 'guild_id']) {
        if (payload[key]) metadata[key] = payload[key];
    }
    const result = await pool.query(`
        WITH inserted AS (
            INSERT INTO chat_messages
                (platform, conversation_id, message_id, role, payload, created_at)
            VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz)
            ON CONFLICT (platform, message_id) DO NOTHING
            RETURNING 1
        ), session_upsert AS (
            INSERT INTO chat_sessions
                (platform, conversation_id, user_id, status, metadata, last_message_at)
            VALUES (
                $1, $2, CASE WHEN $4 = 'user' THEN $7 ELSE NULL END,
                'active', $8::jsonb, $6::timestamptz
            )
            ON CONFLICT (platform, conversation_id) DO UPDATE
            SET user_id = COALESCE(EXCLUDED.user_id, chat_sessions.user_id),
                status = 'active',
                metadata = chat_sessions.metadata || EXCLUDED.metadata,
                updated_at = NOW(),
                last_message_at = GREATEST(chat_sessions.last_message_at, EXCLUDED.last_message_at)
            RETURNING 1
        )
        SELECT EXISTS (SELECT 1 FROM inserted) AS inserted
    `, [
        payload.platform,
        payload.conversation_id,
        payload.message_id,
        payload.role,
        JSON.stringify(payload),
        payload.timestamp,
        payload.user_id || null,
        JSON.stringify(metadata),
    ]);
    return result.rows[0]?.inserted === true;
}

async function getMessages(pool, { platform, conversationId, limit = 20 }) {
    if (!platform || !conversationId) {
        throw new TypeError('platform and conversationId are required.');
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new RangeError('History limit must be an integer between 1 and 100.');
    }
    const { rows } = await pool.query(`
        SELECT payload
        FROM chat_messages
        WHERE platform = $1 AND conversation_id = $2
        ORDER BY created_at DESC, id DESC
        LIMIT $3
    `, [platform, conversationId, limit]);
    return rows.map(row => row.payload).reverse();
}

async function exportHistory(pool, filePath, platform) {
    const values = [];
    let platformFilter = '';
    if (platform) {
        values.push(platform);
        platformFilter = 'WHERE platform = $1';
    }
    const { rows } = await pool.query(`
        SELECT payload
        FROM chat_messages
        ${platformFilter}
        ORDER BY created_at ASC, id ASC
    `, values);
    const document = {
        format: 'zeus-chat-history',
        version: 1,
        exported_at: new Date().toISOString(),
        messages: rows.map(row => row.payload),
    };
    const absolutePath = path.resolve(filePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
    return document.messages.length;
}

async function importHistory(pool, filePath, platform) {
    const document = JSON.parse(await fs.readFile(filePath, 'utf8'));
    const entries = Array.isArray(document) ? document : document.messages;
    if (!Array.isArray(entries)) {
        throw new TypeError('History JSON must be an array or an object with a messages array.');
    }

    const client = await pool.connect();
    let imported = 0;
    try {
        await client.query('BEGIN');
        for (const entry of entries) {
            if (await appendMessage(client, normalizeMessage(entry, platform))) {
                imported += 1;
            }
        }
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
    return imported;
}

async function main(args = process.argv.slice(2)) {
    const [action, filePath = path.join(__dirname, 'history.json'), platform] = args;
    const database = require('./index');
    try {
        await database.init();
        if (action === 'export') {
            const count = await exportHistory(database.pool, filePath, platform);
            console.log(`Exported ${count} messages to ${path.resolve(filePath)}.`);
        } else if (action === 'import') {
            const count = await importHistory(database.pool, filePath, platform);
            console.log(`Imported ${count} messages from ${path.resolve(filePath)}.`);
        } else {
            throw new Error('Usage: node database/history.js <export|import> [file.json] [platform]');
        }
    } finally {
        await database.close();
    }
}

if (require.main === module) {
    main().catch(error => {
        console.error('[DATABASE] Message history operation failed:', error);
        process.exitCode = 1;
    });
}

module.exports = { appendMessage, exportHistory, getMessages, importHistory, normalizeMessage };
