const { requestJson } = require('./agentBridge');

const POLL_INTERVAL_MS = 1_000;
const RUN_TIMEOUT_MS = 14 * 60 * 1_000;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getModelScope(guildId, userId) {
    return guildId ? `discord:guild:${guildId}` : `discord:user:${userId}`;
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
    conversationId,
    guildId,
    userId,
    username,
    messageId,
    prompt,
}) {
    const { db } = client;
    const scopeId = getModelScope(guildId, userId);
    await db.appendMessage({
        platform: 'discord',
        conversation_id: conversationId,
        message_id: messageId,
        role: 'user',
        content: prompt,
        user_id: userId,
        username,
        channel_id: conversationId,
        guild_id: guildId || null,
        timestamp: new Date().toISOString(),
    });

    const history = await db.getMessages({
        platform: 'discord',
        conversationId,
        limit: 20,
    });
    const selection = await selectModel(db, scopeId);
    const run = await requestJson('/agent/run', {
        method: 'POST',
        body: {
            provider: selection.provider,
            model: selection.model,
            platform: 'discord',
            session: {
                platform: 'discord',
                conversation_id: conversationId,
                user_id: userId,
                metadata: {
                    guild_id: guildId || null,
                    channel_id: conversationId,
                },
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
    conversationId,
    guildId,
    messageId,
    content,
    promptTokens = 0,
    completionTokens = 0,
}) {
    await client.db.appendMessage({
        platform: 'discord',
        conversation_id: conversationId,
        message_id: messageId,
        role: 'assistant',
        content,
        usage: {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
        },
        user_id: client.user?.id || 'zeus',
        username: client.user?.username || 'Zeus',
        channel_id: conversationId,
        guild_id: guildId || null,
        timestamp: new Date().toISOString(),
    });
}

module.exports = {
    generateConversationReply,
    getModelScope,
    selectModel,
    storeAssistantReply,
};
