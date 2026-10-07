// Shared PostgreSQL database router for platform adapters and the WebUI.

const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');
const { appendMessage, exportHistory, getMessages, importHistory } = require('../database/history');

const pool = new Pool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'zeus',
    user: process.env.DB_USER || 'zeus',
    password: process.env.DB_PASSWORD,
});
pool.on('error', error => {
    console.error('[DATABASE] Unexpected PostgreSQL pool error:', error);
});

let initialization;

async function init() {
    if (initialization) return initialization;
    initialization = (async () => {
        const schema = await fs.readFile(path.join(__dirname, '..', 'database', 'schema.sql'), 'utf8');
        await pool.query(schema);
    })().catch(error => {
        initialization = undefined;
        throw error;
    });
    return initialization;
}

async function getHelpPreference(userId) {
    const { rows } = await pool.query(
        'SELECT last_categories FROM help_preferences WHERE user_id = $1',
        [userId],
    );
    const categories = rows[0]?.last_categories;
    return Array.isArray(categories) && categories.length > 0 ? categories : ['all'];
}

async function setHelpPreference(userId, categories) {
    const normalized = Array.isArray(categories) ? categories : [categories];
    await pool.query(`
        INSERT INTO help_preferences (user_id, last_categories)
        VALUES ($1, $2::jsonb)
        ON CONFLICT (user_id) DO UPDATE
        SET last_categories = EXCLUDED.last_categories
    `, [userId, JSON.stringify(normalized)]);
}

async function ensureDefaultUserSettings(userId) {
    const { rowCount } = await pool.query(`
        INSERT INTO user_settings (user_id, setting_id, value)
        SELECT $1, setting_id, TRUE
        FROM (VALUES ('reminder'), ('daily_reminder'), ('lvl_notifi')) defaults(setting_id)
        WHERE NOT EXISTS (
            SELECT 1 FROM user_settings WHERE user_id = $1
        )
        ON CONFLICT (user_id, setting_id) DO NOTHING
    `, [userId]);
    return rowCount > 0;
}

async function recordUserActivity(userId, timestamp = Date.now(), force = false) {
    await pool.query(`
        INSERT INTO user_activity (user_id, last_command_at)
        SELECT $1, $2
        WHERE $3 = TRUE OR EXISTS (
            SELECT 1 FROM user_settings
            WHERE user_id = $1 AND setting_id = 'passive' AND value = TRUE
        )
        ON CONFLICT (user_id) DO UPDATE
        SET last_command_at = EXCLUDED.last_command_at
    `, [userId, timestamp, force]);
}

async function getModelPreference(scopeId) {
    const { rows } = await pool.query(
        'SELECT provider_name AS provider, model_id AS model FROM model_preferences WHERE scope_id = $1',
        [scopeId],
    );
    return rows[0] || null;
}

async function setModelPreference(scopeId, providerName, modelId) {
    await pool.query(`
        INSERT INTO model_preferences (scope_id, provider_name, model_id, updated_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (scope_id) DO UPDATE
        SET provider_name = EXCLUDED.provider_name,
            model_id = EXCLUDED.model_id,
            updated_at = NOW()
    `, [scopeId, providerName, modelId]);
}

async function registerChatThread({ threadId, guildId, parentChannelId, ownerId }) {
    await pool.query(`
        INSERT INTO chat_threads (thread_id, platform, guild_id, parent_channel_id, owner_id)
        VALUES ($1, 'discord', $2, $3, $4)
        ON CONFLICT (thread_id) DO NOTHING
    `, [threadId, guildId, parentChannelId, ownerId]);
}

async function getChatThread(threadId) {
    const { rows } = await pool.query(
        'SELECT thread_id, guild_id, parent_channel_id, owner_id FROM chat_threads WHERE thread_id = $1 AND platform = $2',
        [threadId, 'discord'],
    );
    return rows[0] || null;
}

async function removeChatThread(threadId) {
    await pool.query(
        'DELETE FROM chat_threads WHERE thread_id = $1 AND platform = $2',
        [threadId, 'discord'],
    );
}

async function getSession(platform, conversationId) {
    const { rows } = await pool.query(`
        SELECT session_id, platform, conversation_id, user_id, status, metadata,
               created_at, updated_at, last_message_at
        FROM chat_sessions
        WHERE platform = $1 AND conversation_id = $2
    `, [platform, conversationId]);
    return rows[0] || null;
}

async function upsertSession({
    platform,
    conversationId,
    userId = null,
    metadata = {},
}) {
    if (typeof platform !== 'string' || !platform.trim()
        || typeof conversationId !== 'string' || !conversationId.trim()) {
        throw new TypeError('Platform and conversation ID are required.');
    }
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
        throw new TypeError('Session metadata must be an object.');
    }
    const { rows } = await pool.query(`
        INSERT INTO chat_sessions (platform, conversation_id, user_id, metadata)
        VALUES ($1, $2, $3, $4::jsonb)
        ON CONFLICT (platform, conversation_id) DO UPDATE
        SET user_id = COALESCE(EXCLUDED.user_id, chat_sessions.user_id),
            status = 'active',
            metadata = chat_sessions.metadata || EXCLUDED.metadata,
            updated_at = NOW()
        RETURNING session_id, platform, conversation_id, user_id, status, metadata,
                  created_at, updated_at, last_message_at
    `, [platform.trim().toLowerCase(), conversationId, userId, JSON.stringify(metadata)]);
    return rows[0] || null;
}

async function updateSessionStatus(platform, conversationId, status) {
    if (!['active', 'closed'].includes(status)) {
        throw new TypeError('Session status must be active or closed.');
    }
    const { rows } = await pool.query(`
        UPDATE chat_sessions
        SET status = $3, updated_at = NOW()
        WHERE platform = $1 AND conversation_id = $2
        RETURNING session_id, platform, conversation_id, user_id, status, metadata,
                  created_at, updated_at, last_message_at
    `, [platform, conversationId, status]);
    return rows[0] || null;
}

async function resetSession(platform, conversationId) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(
            'DELETE FROM chat_messages WHERE platform = $1 AND conversation_id = $2',
            [platform, conversationId],
        );
        const { rows } = await client.query(`
            UPDATE chat_sessions
            SET metadata = metadata - 'usage',
                last_message_at = NULL,
                status = 'active',
                updated_at = NOW()
            WHERE platform = $1 AND conversation_id = $2
            RETURNING session_id
        `, [platform, conversationId]);
        await client.query('COMMIT');
        return rows.length > 0;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function getSessionUsage(platform, conversationId) {
    const { rows } = await pool.query(`
        SELECT
            COALESCE(SUM(NULLIF(payload->'usage'->>'prompt_tokens', '')::BIGINT), 0)::BIGINT AS prompt_tokens,
            COALESCE(SUM(NULLIF(payload->'usage'->>'completion_tokens', '')::BIGINT), 0)::BIGINT AS completion_tokens
        FROM chat_messages
        WHERE platform = $1 AND conversation_id = $2 AND role = 'assistant'
    `, [platform, conversationId]);
    return {
        promptTokens: Number(rows[0]?.prompt_tokens || 0),
        completionTokens: Number(rows[0]?.completion_tokens || 0),
    };
}

async function getRetryPrompt(platform, conversationId) {
    const { rows } = await pool.query(`
        WITH latest_user AS (
            SELECT id, created_at, payload
            FROM chat_messages
            WHERE platform = $1 AND conversation_id = $2 AND role = 'user'
            ORDER BY created_at DESC, id DESC
            LIMIT 1
        )
        SELECT latest_user.payload
        FROM latest_user
        WHERE NOT EXISTS (
            SELECT 1
            FROM chat_messages AS assistant
            WHERE assistant.platform = $1
              AND assistant.conversation_id = $2
              AND assistant.role = 'assistant'
              AND (assistant.created_at, assistant.id) > (latest_user.created_at, latest_user.id)
        )
    `, [platform, conversationId]);
    return rows[0]?.payload || null;
}

async function setHomeChannel(guildId, channelId) {
    const { rows } = await pool.query(`
        INSERT INTO discord_guild_settings (guild_id, home_channel_id)
        VALUES ($1, $2)
        ON CONFLICT (guild_id) DO UPDATE
        SET home_channel_id = EXCLUDED.home_channel_id, updated_at = NOW()
        RETURNING guild_id, home_channel_id
    `, [guildId, channelId]);
    return rows[0] || null;
}

async function getHomeChannel(guildId) {
    const { rows } = await pool.query(
        'SELECT home_channel_id FROM discord_guild_settings WHERE guild_id = $1',
        [guildId],
    );
    return rows[0]?.home_channel_id || null;
}

async function setTelegramHomeChat(chatId) {
    if (chatId === null) {
        await pool.query('DELETE FROM telegram_home_chat WHERE setting_id = 1');
        return null;
    }
    const { rows } = await pool.query(`
        INSERT INTO telegram_home_chat (setting_id, chat_id)
        VALUES (1, $1)
        ON CONFLICT (setting_id) DO UPDATE
        SET chat_id = EXCLUDED.chat_id, updated_at = NOW()
        RETURNING chat_id
    `, [String(chatId)]);
    return rows[0]?.chat_id || null;
}

async function getTelegramHomeChat() {
    const { rows } = await pool.query(
        'SELECT chat_id FROM telegram_home_chat WHERE setting_id = 1',
    );
    return rows[0]?.chat_id || null;
}

async function close() {
    if (initialization) await initialization.catch(() => {});
    initialization = undefined;
    await pool.end();
}

const database = {
    appendMessage: entry => appendMessage(pool, entry),
    close,
    exportHistory: (filePath, platform) => exportHistory(pool, filePath, platform),
    getHelpPreference,
    getMessages: options => getMessages(pool, options),
    ensureDefaultUserSettings,
    getChatThread,
    getHomeChannel,
    getModelPreference,
    getRetryPrompt,
    getSession,
    getSessionUsage,
    importHistory: (filePath, platform) => importHistory(pool, filePath, platform),
    init,
    pool,
    registerChatThread,
    recordUserActivity,
    removeChatThread,
    setModelPreference,
    setHelpPreference,
    setHomeChannel,
    getTelegramHomeChat,
    setTelegramHomeChat,
    resetSession,
    upsertSession,
    updateSessionStatus,
};

function forPlatform(platform) {
    if (typeof platform !== 'string' || !platform.trim()) {
        throw new TypeError('A platform name is required.');
    }
    const name = platform.trim().toLowerCase();
    return Object.freeze({
        ...database,
        appendMessage: entry => database.appendMessage({ ...entry, platform: entry.platform || name }),
        getMessages: options => database.getMessages({ ...options, platform: options.platform || name }),
        getSession: conversationId => database.getSession(name, conversationId),
        upsertSession: (conversationId, options = {}) => database.upsertSession({
            ...options,
            platform: name,
            conversationId,
        }),
        updateSessionStatus: (conversationId, status) => database.updateSessionStatus(name, conversationId, status),
    });
}

module.exports = { ...database, forPlatform };
