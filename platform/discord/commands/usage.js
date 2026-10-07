const { requestJson } = require('../utils/agentBridge');

function formatTokens(value) {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
    return String(value);
}

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
        const usage = await requestJson(
            `/sessions/usage?platform=discord&conversation_id=${encodeURIComponent(message.channelId)}`,
        );
        await message.reply(
            `Session usage: **${formatTokens(usage.prompt_tokens)} input** / `
            + `**${formatTokens(usage.completion_tokens)} output** tokens.`,
        );
    },
};
