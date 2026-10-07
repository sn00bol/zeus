const defaultSleep = delayMs => new Promise(resolve => setTimeout(resolve, delayMs));

async function retryWithBackoff(operation, options = {}) {
    const {
        initialDelayMs = 1_000,
        maxDelayMs = 60_000,
        maxAttempts = Number.POSITIVE_INFINITY,
        shouldRetry = () => true,
        onRetry = () => { },
        sleep = defaultSleep,
    } = options;

    let attempt = 0;
    while (true) {
        try {
            return await operation();
        } catch (error) {
            attempt += 1;
            if (attempt >= maxAttempts || !shouldRetry(error)) throw error;

            const delayMs = Math.min(initialDelayMs * (2 ** (attempt - 1)), maxDelayMs);
            onRetry(error, attempt, delayMs);
            await sleep(delayMs);
        }
    }
}

module.exports = { retryWithBackoff };