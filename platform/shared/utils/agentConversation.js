const { requestJson } = require('./agentBridge');

const POLL_INTERVAL_MS = 1_000;
const RUN_TIMEOUT_MS = 14 * 60 * 1_000;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getModelScope(platform, guildId, userId) {
    if (platform === 'telegram') return `telegram:user:${userId}`;
    if (platform === 'discord') {
        return guildId ? `discord:guild:${guildId}` : `discord:user:${userId}`;
    }
    throw new TypeError(`Unsupported conversation platform: ${platform}`);
}

async function selectModel(database, scopeId) {
    const preference = await database.getModelPreference(scopeId);
    if (preference?.provider && preference?.model) return preference;

    const { models } = await requestJson('/models');
    if (!Array.isArray(models) || models.length === 0) {
        throw new Error('No local AI models are available. Start a supported provider and load a model.');
    }
    return models[0];
}

async function waitForRun(runId) {
    const deadline = Date.now() + RUN_TIMEOUT_MS;
    while (Date.now() < deadline) {
        const run = await requestJson(`/agent/runs/${encodeURIComponent(runId)}`);
        if (run.status === 'completed') return run.result;
        if (run.status === 'failed') throw new Error(run.error || 'The agent run failed.');
        await sleep(POLL_INTERVAL_MS);
    }
    throw new Error(`Agent run ${runId} is still running. Try again later.`);
}

async function generateConversationReply({
    client,
    platform,
    conversationId,
    guildId,
    userId,
    username,
    messageId,
    prompt,
}) {
    if (!['discord', 'telegram'].includes(platform)) {
        throw new TypeError(`Unsupported conversation platform: ${platform}`);
    }
    const { db } = client;
    const scopeId = getModelScope(platform, guildId, userId);
    const normalizedConversationId = String(conversationId);
    const normalizedUserId = String(userId);
    await db.appendMessage({
        platform,
        conversation_id: normalizedConversationId,
        message_id: String(messageId),
        role: 'user',
        content: prompt,
        user_id: normalizedUserId,
        username,
        channel_id: normalizedConversationId,
        guild_id: platform === 'discord' ? guildId || null : null,
        timestamp: new Date().toISOString(),
    });

    const history = await db.getMessages({
        platform,
        conversationId: normalizedConversationId,
        limit: 20,
    });
    const selection = await selectModel(db, scopeId);
    const metadata = { channel_id: normalizedConversationId };
    if (platform === 'discord') metadata.guild_id = guildId || null;

    const run = await requestJson('/agent/run', {
        method: 'POST',
        body: {
            provider: selection.provider,
            model: selection.model,
            platform,
            session: {
                platform,
                conversation_id: normalizedConversationId,
                user_id: normalizedUserId,
                metadata,
            },
            messages: history.map(message => ({
                role: message.role,
                content: message.content,
            })),
        },
    });
    const result = await waitForRun(run.run_id);
    return {
        content: result.content,
        model: selection.model,
        provider: selection.provider,
        scopeId,
        promptTokens: result.prompt_tokens || 0,
        completionTokens: result.completion_tokens || 0,
    };
}

async function storeAssistantReply(client, {
    platform,
    conversationId,
    guildId,
    messageId,
    content,
    promptTokens = 0,
    completionTokens = 0,
}) {
    if (!['discord', 'telegram'].includes(platform)) {
        throw new TypeError(`Unsupported conversation platform: ${platform}`);
    }
    const isDiscord = platform === 'discord';
    await client.db.appendMessage({
        platform,
        conversation_id: String(conversationId),
        message_id: String(messageId),
        role: 'assistant',
        content,
        usage: {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
        },
        user_id: isDiscord ? client.user?.id || 'zeus' : 'zeus',
        username: isDiscord ? client.user?.username || 'Zeus' : 'Zeus',
        channel_id: String(conversationId),
        guild_id: isDiscord ? guildId || null : null,
        timestamp: new Date().toISOString(),
    });
}

module.exports = {
    generateConversationReply,
    getModelScope,
    selectModel,
    storeAssistantReply,
    waitForRun,
};
