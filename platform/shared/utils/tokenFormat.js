function formatTokens(value, { trimWholeDecimal = false } = {}) {
    const tokens = Number(value) || 0;
    if (tokens >= 1_000_000) {
        const amount = (tokens / 1_000_000).toFixed(1);
        return `${trimWholeDecimal ? Number(amount) : amount}m`;
    }
    if (tokens >= 1_000) {
        const amount = (tokens / 1_000).toFixed(1);
        return `${trimWholeDecimal ? Number(amount) : amount}k`;
    }
    return String(tokens);
}

module.exports = { formatTokens };
