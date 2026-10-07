const { sendFormattedMessage } = require('../utils/formatter');
const { getConversationStatus } = require('../../shared/utils/sessionCommands');
const { getStatusSummary } = require('../../shared/utils/statusSummary');

module.exports = {
    name: 'status',
    description: 'Show ZEUS host, model, session, cache, and queue status',
    usage: '/status',
    async execute(bot, ctx, args, state) {
        const conversationId = String(ctx.chat.id);
        const status = await getConversationStatus('telegram', conversationId);
        const summary = getStatusSummary(status);
        const report = [
            `**⚡ ZEUS ${summary.version}**`,
            `**🧠 Model:** \`${summary.provider}/${summary.model}\``,
            `**🧮 Tokens:** ${summary.inputTokens} in / ${summary.outputTokens} out`,
            `**📚 Cache:** ${summary.cache}`,
            `**📚 Context:** ${summary.context}`,
            `**🧵 Session:** ${summary.sessionName} · ${summary.sessionUpdated}`,
            `**🪢 Queue:** ${summary.queue.collecting ? 'collecting' : 'idle'} · depth ${summary.queue.queue_depth || 0}`,
            `**🔹 Database:** ${state.databasesReady ? 'ready' : 'not ready'} · **Bot:** ${state.isShuttingDown ? 'shutting down' : 'active'}`,
        ].join('\n');
        await sendFormattedMessage(ctx, report);
    },
};
