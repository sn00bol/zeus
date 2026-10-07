const SUPPORTED_PLATFORMS = new Set(['discord', 'telegram']);

function resolvePlatform(value = process.env.PLATFORM || 'discord') {
    const platform = String(value).trim().toLowerCase();
    if (!SUPPORTED_PLATFORMS.has(platform)) {
        throw new Error(
            `Unsupported PLATFORM '${value}'. Choose 'discord' or 'telegram' in .env.`,
        );
    }
    return platform;
}

function getPlatformEntry(platform) {
    return require.resolve(`../${resolvePlatform(platform)}/index.js`);
}

module.exports = { getPlatformEntry, resolvePlatform };
