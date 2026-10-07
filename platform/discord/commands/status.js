const { EmbedBuilder } = require('discord.js');
const { requestJson } = require('../utils/agentBridge');

function formatTokens(value) {
    const tokens = Number(value) || 0;
    if (tokens >= 1_000_000) return `${Number((tokens / 1_000_000).toFixed(1))}m`;
    if (tokens >= 1_000) return `${Number((tokens / 1_000).toFixed(1))}k`;
    return String(tokens);
}

function updatedAgo(value) {
    if (!value) return 'no messages yet';
    const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000));
    if (seconds < 60) return 'updated just now';
    if (seconds < 3600) return `updated ${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `updated ${Math.floor(seconds / 3600)}h ago`;
    return `updated ${Math.floor(seconds / 86400)}d ago`;
}

module.exports = {
    name: 'status',
    description: 'Show ZEUS host, model, session, cache, and queue status',
    usage: 'Zstatus',
    DMs: false,
    prefixOnly: true,
    async execute(message) {
        const conversationId = message.channel.isThread?.() ? message.channelId : '';
        const status = await requestJson(
            `/status?platform=discord&conversation_id=${encodeURIComponent(conversationId)}`,
        );
        const session = status.session;
        const latest = status.agent?.last_result || {};
        const runtimeModel = status.model || {};
        const provider = session?.provider || latest.provider
            || runtimeModel.provider || process.env.ZEUS_PROVIDER || 'unknown';
        const model = session?.model || latest.model || runtimeModel.model || 'no model loaded';
        const inputTokens = session?.prompt_tokens ?? latest.prompt_tokens ?? 0;
        const outputTokens = session?.completion_tokens ?? latest.completion_tokens ?? 0;
        const cache = status.model_cache || {};
        const cacheRequests = Number(cache.hits || 0) + Number(cache.misses || 0);
        const cachePercent = cacheRequests
            ? Math.round((Number(cache.hits || 0) / cacheRequests) * 100)
            : 0;
        const contextLimit = Number(
            session?.context_length || runtimeModel.context_length || 0,
        );
        const contextTokens = Number(
            session?.last_prompt_tokens ?? latest.prompt_tokens ?? 0,
        ) + Number(session?.last_completion_tokens ?? latest.completion_tokens ?? 0);
        const contextPercent = contextLimit
            ? Math.min(100, Math.round((contextTokens / contextLimit) * 100))
            : 0;
        const sessionName = conversationId && session?.id
            ? `session-${session.id}`
            : 'no active thread';
        const queue = status.agent || {};
        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(`⚡ ZEUS ${status.version || 'unknown'}`)
            .setDescription('Host AI agent status')
            .addFields(
                {
                    name: '🧠 Model',
                    value: `\`${provider}/${model}\``,
                    inline: true,
                },
                {
                    name: '🧮 Tokens',
                    value: `${formatTokens(inputTokens)} in / ${formatTokens(outputTokens)} out`,
                    inline: true,
                },
                {
                    name: '🗄️ Cache',
                    value: `${cachePercent}% hit · ${cache.cached_models || 0} models · ${cache.misses || 0} misses`,
                    inline: true,
                },
                {
                    name: '📚 Context',
                    value: contextLimit
                        ? `${formatTokens(contextTokens)}/${formatTokens(contextLimit)} (${contextPercent}%)`
                        : `${formatTokens(contextTokens)}/unknown`,
                    inline: true,
                },
                {
                    name: '🧵 Session',
                    value: `\`${sessionName}\`\n${updatedAgo(session?.updated_at)}`,
                    inline: true,
                },
                {
                    name: '🪢 Queue',
                    value: `${queue.collecting ? 'collecting' : 'idle'} · depth ${queue.queue_depth || 0}`,
                    inline: true,
                },
            )
            .setTimestamp(new Date());
        await message.reply({ embeds: [embed] });
    },
};
