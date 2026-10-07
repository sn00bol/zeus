require('dotenv').config();

const { Telegraf } = require('telegraf');
const { loadCommands } = require('../handlers/commandHandler');

const MAX_COMMANDS = 100;
const COMMAND_NAME = /^[a-z0-9_]{1,32}$/;
const DEFAULT_SCOPE = { scope: { type: 'default' } };

function buildTelegramCommands(commands) {
    const entries = commands instanceof Map
        ? [...commands.values()]
        : [...commands];
    const result = [];
    const seen = new Set();

    for (const command of entries) {
        const name = command?.name;
        if (typeof name !== 'string' || !COMMAND_NAME.test(name)) {
            console.warn(`[COMMANDS] Skipping invalid Telegram command name: ${String(name)}`);
            continue;
        }
        if (seen.has(name)) {
            console.warn(`[COMMANDS] Skipping duplicate Telegram command: ${name}`);
            continue;
        }
        seen.add(name);

        const description = String(command.description || `Run the ${name} command.`)
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 256);
        result.push({
            command: name,
            description: description || `Run the ${name} command.`,
        });
    }

    if (result.length > MAX_COMMANDS) {
        console.warn(`[COMMANDS] Telegram supports at most ${MAX_COMMANDS} commands; extras will be skipped.`);
        return result.slice(0, MAX_COMMANDS);
    }
    return result;
}

function haveSameCommands(current, desired) {
    return current.length === desired.length
        && current.every((command, index) => command.command === desired[index].command
            && command.description === desired[index].description);
}

async function synchronizeTelegramCommands(telegram, commands, { force = false } = {}) {
    const desired = buildTelegramCommands(commands);
    const current = await telegram.getMyCommands(DEFAULT_SCOPE);
    if (!force && haveSameCommands(current, desired)) {
        console.log(`[COMMANDS] Telegram menu already up to date (${desired.length} commands).`);
        return { changed: false, total: desired.length };
    }

    await telegram.setMyCommands(desired, DEFAULT_SCOPE);
    console.log(`[COMMANDS] Registered ${desired.length} Telegram commands.`);
    return { changed: true, total: desired.length };
}

async function runCommandRegister({ force = false } = {}) {
    const token = process.env.TELEGRAM_BOT_API_KEY;
    if (!token) throw new Error('TELEGRAM_BOT_API_KEY is required to register Telegram commands.');

    const bot = new Telegraf(token);
    loadCommands(bot);
    return synchronizeTelegramCommands(bot.telegram, bot.commands, { force });
}

if (require.main === module) {
    runCommandRegister().catch(error => {
        console.error('[COMMANDS] Telegram command registration failed:', error);
        process.exitCode = 1;
    });
}

module.exports = {
    buildTelegramCommands,
    haveSameCommands,
    runCommandRegister,
    synchronizeTelegramCommands,
};
