const shared = require('../../shared/utils/agentConversation');

module.exports = {
    ...shared,
    getModelScope: (guildId, userId) => shared.getModelScope('discord', guildId, userId),
    generateConversationReply: options => shared.generateConversationReply({
        ...options,
        platform: 'discord',
    }),
    storeAssistantReply: (client, options) => shared.storeAssistantReply(client, {
        ...options,
        platform: 'discord',
    }),
};
