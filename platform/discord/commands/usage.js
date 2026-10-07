const { getConversationUsage } = require('../../shared/utils/sessionCommands');
const { formatTokens } = require('../../shared/utils/tokenFormat');

module.exports = {
    name: 'usage',
    description: 'Show token usage for the current ZEUS thread',
    usage: 'Zusage',
    DMs: false,
    prefixOnly: true,
    async execute(message) {
        if (!message.channel.isThread?.()
            || !await message.client.db.getChatThread(message.channelId)) {
            await message.reply('Run `usage` inside a ZEUS chat thread.');
            return;
        }
        const usage = await getConversationUsage('discord', message.channelId);
        await message.reply(
            `Session usage: **${formatTokens(usage.prompt_tokens)} input** / `
            + `**${formatTokens(usage.completion_tokens)} output** tokens.`,
        );
    },
};
