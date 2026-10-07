const { resetConversation } = require('../../shared/utils/sessionCommands');

module.exports = {
    name: 'reset',
    description: 'Clear the current ZEUS chat history and token usage',
    usage: '/reset',
    async execute(bot, ctx) {
        const result = await resetConversation('telegram', ctx.chat.id);
        await ctx.reply(result.reset
            ? 'This chat’s conversation and usage have been reset. Long-term memory is unchanged.'
            : 'No session was found for this chat.');
    },
};
