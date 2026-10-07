const { formatTokens } = require('./tokenFormat');

function updatedAgo(value) {
    if (!value) return 'no messages yet';
    const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000));
    if (seconds < 60) return 'updated just now';
    if (seconds < 3600) return `updated ${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `updated ${Math.floor(seconds / 3600)}h ago`;
    return `updated ${Math.floor(seconds / 86400)}d ago`;
}

function getStatusSummary(status) {
    const session = status.session || {};
    const latest = status.agent?.last_result || {};
    const runtimeModel = status.model || {};
    const provider = session.provider || latest.provider
        || runtimeModel.provider || process.env.ZEUS_PROVIDER || 'unknown';
    const model = session.model || latest.model || runtimeModel.model || 'no model loaded';
    const inputTokens = session.prompt_tokens ?? latest.prompt_tokens ?? 0;
    const outputTokens = session.completion_tokens ?? latest.completion_tokens ?? 0;
    const cache = status.model_cache || {};
    const cacheRequests = Number(cache.hits || 0) + Number(cache.misses || 0);
    const cachePercent = cacheRequests
        ? Math.round((Number(cache.hits || 0) / cacheRequests) * 100)
        : 0;
    const contextLimit = Number(session.context_length || runtimeModel.context_length || 0);
    const contextTokens = Number(
        session.last_prompt_tokens ?? latest.prompt_tokens ?? 0,
    ) + Number(session.last_completion_tokens ?? latest.completion_tokens ?? 0);
    const contextPercent = contextLimit
        ? Math.min(100, Math.round((contextTokens / contextLimit) * 100))
        : 0;

    return {
        version: status.version || 'unknown',
        provider,
        model,
        inputTokens: formatTokens(inputTokens, { trimWholeDecimal: true }),
        outputTokens: formatTokens(outputTokens, { trimWholeDecimal: true }),
        cache: `${cachePercent}% hit · ${cache.cached_models || 0} models · ${cache.misses || 0} misses`,
        context: contextLimit
            ? `${formatTokens(contextTokens, { trimWholeDecimal: true })}/${formatTokens(contextLimit, { trimWholeDecimal: true })} (${contextPercent}%)`
            : `${formatTokens(contextTokens, { trimWholeDecimal: true })}/unknown`,
        sessionName: session.id ? `session-${session.id}` : 'no active chat',
        sessionUpdated: updatedAgo(session.updated_at),
        queue: status.agent || {},
    };
}

module.exports = { formatTokens, getStatusSummary, updatedAgo };
