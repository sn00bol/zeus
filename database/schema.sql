CREATE TABLE IF NOT EXISTS help_preferences (
    user_id TEXT PRIMARY KEY,
    last_categories JSONB NOT NULL DEFAULT '["all"]'::jsonb
);

CREATE TABLE IF NOT EXISTS user_settings (
    user_id TEXT NOT NULL,
    setting_id TEXT NOT NULL,
    value BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (user_id, setting_id)
);

CREATE TABLE IF NOT EXISTS user_activity (
    user_id TEXT PRIMARY KEY,
    last_command_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_settings_setting_value
    ON user_settings (setting_id, value);
CREATE INDEX IF NOT EXISTS idx_user_activity_last_command
    ON user_activity (last_command_at);

CREATE TABLE IF NOT EXISTS chat_messages (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    platform TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant')),
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    UNIQUE (platform, message_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation
    ON chat_messages (platform, conversation_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS chat_sessions (
    session_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    platform TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    user_id TEXT,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'closed')),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_message_at TIMESTAMPTZ,
    UNIQUE (platform, conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_status_updated
    ON chat_sessions (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS conversation_memories (
    memory_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    platform TEXT NOT NULL,
    user_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    content TEXT NOT NULL,
    search_vector TSVECTOR GENERATED ALWAYS AS (
        to_tsvector('simple', content)
    ) STORED,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conversation_memories_search
    ON conversation_memories USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS idx_conversation_memories_owner_expiry
    ON conversation_memories (platform, user_id, expires_at);

CREATE TABLE IF NOT EXISTS extracted_memories (
    memory_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    platform TEXT NOT NULL,
    user_id TEXT NOT NULL,
    content TEXT NOT NULL,
    search_vector TSVECTOR GENERATED ALWAYS AS (
        to_tsvector('simple', content)
    ) STORED,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_extracted_memories_search
    ON extracted_memories USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS idx_extracted_memories_owner_expiry
    ON extracted_memories (platform, user_id, expires_at);

CREATE TABLE IF NOT EXISTS model_preferences (
    scope_id TEXT PRIMARY KEY,
    provider_name TEXT,
    model_id TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((provider_name IS NULL AND model_id IS NULL)
        OR (provider_name IS NOT NULL AND model_id IS NOT NULL))
);
DELETE FROM model_preferences
WHERE provider_name LIKE 'external:%';

CREATE TABLE IF NOT EXISTS model_controls (
    provider_name TEXT NOT NULL,
    model_id TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (provider_name, model_id)
);
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'model_controls'
          AND column_name = 'deleted'
    ) THEN
        EXECUTE 'UPDATE model_controls SET enabled = FALSE WHERE deleted = TRUE';
        EXECUTE 'ALTER TABLE model_controls DROP COLUMN deleted';
    END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS chat_threads (
    thread_id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    parent_channel_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS discord_guild_settings (
    guild_id TEXT PRIMARY KEY,
    home_channel_id TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS telegram_home_chat (
    setting_id SMALLINT PRIMARY KEY CHECK (setting_id = 1),
    chat_id TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
