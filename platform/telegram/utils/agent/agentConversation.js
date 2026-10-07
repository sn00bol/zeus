const shared = require('../../../shared/utils/agentConversation');

module.exports = {
    ...shared,
    getModelScope: userId => shared.getModelScope('telegram', null, userId),
    generateConversationReply: options => shared.generateConversationReply({
        ...options,
        platform: 'telegram',
    }),
    storeAssistantReply: (client, options) => shared.storeAssistantReply(client, {
        ...options,
        platform: 'telegram',
    }),
};
