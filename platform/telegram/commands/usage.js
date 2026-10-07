const { getConversationUsage } = require('../../shared/utils/sessionCommands');
const { formatTokens } = require('../../shared/utils/tokenFormat');

module.exports = {
    name: 'usage',
    description: 'Show token usage for the current ZEUS chat',
    usage: '/usage',
    async execute(bot, ctx) {
        const usage = await getConversationUsage('telegram', ctx.chat.id);
        await ctx.reply(
            `Session usage: ${formatTokens(usage.prompt_tokens)} input / `
            + `${formatTokens(usage.completion_tokens)} output tokens.`,
        );
    },
};
