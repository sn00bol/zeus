const { EmbedBuilder } = require('discord.js');
const { getConversationStatus } = require('../../shared/utils/sessionCommands');
const { getStatusSummary } = require('../../shared/utils/statusSummary');

module.exports = {
    name: 'status',
    description: 'Show ZEUS host, model, session, cache, and queue status',
    usage: 'Zstatus',
    DMs: false,
    prefixOnly: true,
    async execute(message) {
        const conversationId = message.channel.isThread?.() ? message.channelId : '';
        const status = await getConversationStatus('discord', conversationId);
        const summary = getStatusSummary(status);
        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(`⚡ ZEUS ${summary.version}`)
            .setDescription('Host AI agent status')
            .addFields(
                {
                    name: '🧠 Model',
                    value: `\`${summary.provider}/${summary.model}\``,
                    inline: true,
                },
                {
                    name: '🧮 Tokens',
                    value: `${summary.inputTokens} in / ${summary.outputTokens} out`,
                    inline: true,
                },
                {
                    name: '🗄️ Cache',
                    value: summary.cache,
                    inline: true,
                },
                {
                    name: '📚 Context',
                    value: summary.context,
                    inline: true,
                },
                {
                    name: '🧵 Session',
                    value: `\`${conversationId && status.session?.id
                        ? summary.sessionName
                        : 'no active thread'}\`\n${summary.sessionUpdated}`,
                    inline: true,
                },
                {
                    name: '🪢 Queue',
                    value: `${summary.queue.collecting ? 'collecting' : 'idle'} · depth ${summary.queue.queue_depth || 0}`,
                    inline: true,
                },
            )
            .setTimestamp(new Date());
        await message.reply({ embeds: [embed] });
    },
};
