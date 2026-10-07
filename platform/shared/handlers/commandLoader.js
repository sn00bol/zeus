const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

function getCommandFiles(directory) {
    if (!fs.existsSync(directory)) return [];
    const results = [];

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            results.push(...getCommandFiles(fullPath));
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
            results.push(fullPath);
        }
    }
    return results;
}

function loadCommands(target, {
    directory,
    collectionFactory = () => new Map(),
    platform,
    logLoaded = true,
}) {
    const startedAt = performance.now();
    target.commands = collectionFactory();
    target.aliases = collectionFactory();
    const stats = { scanned: 0, failed: 0, loaded: 0 };

    for (const filePath of getCommandFiles(directory)) {
        stats.scanned++;
        try {
            const command = require(filePath);
            if (!command || typeof command !== 'object'
                || typeof command.name !== 'string'
                || typeof command.execute !== 'function') {
                continue;
            }

            target.commands.set(command.name, command);
            stats.loaded++;
            if (!Array.isArray(command.aliases)) continue;

            for (const rawAlias of command.aliases) {
                const alias = String(rawAlias).toLowerCase();
                if (alias && !target.commands.has(alias) && !target.aliases.has(alias)) {
                    target.aliases.set(alias, command);
                }
            }
        } catch (error) {
            stats.failed++;
            console.error(`[${platform}] Failed to load command file ${filePath}:`, error);
        }
    }

    const duration = (performance.now() - startedAt).toFixed(2);
    if (logLoaded) {
        console.log(`[${platform}] Loaded ${stats.loaded} commands in ${duration}ms`);
    }
    return stats;
}

module.exports = { getCommandFiles, loadCommands };
