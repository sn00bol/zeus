const { requestJson } = require('./agentBridge');

function conversationPath(path, platform, conversationId) {
    const query = new URLSearchParams({
        platform,
        conversation_id: String(conversationId),
    });
    return `${path}?${query}`;
}

async function getConversationUsage(platform, conversationId) {
    return requestJson(conversationPath('/sessions/usage', platform, conversationId));
}

async function getRetryPrompt(platform, conversationId) {
    return requestJson(conversationPath('/sessions/retry', platform, conversationId));
}

async function getConversationStatus(platform, conversationId) {
    return requestJson(conversationPath('/status', platform, conversationId));
}

async function resetConversation(platform, conversationId) {
    return requestJson('/sessions/reset', {
        method: 'POST',
        body: {
            platform,
            conversation_id: String(conversationId),
        },
    });
}

module.exports = {
    getConversationUsage,
    getRetryPrompt,
    getConversationStatus,
    resetConversation,
};
