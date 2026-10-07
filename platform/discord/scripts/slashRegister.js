require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Collection, REST, Routes } = require('discord.js');
const {
    buildSlashCommand,
    getSlashCommandSignature,
    getSlashCommandValidationError,
    isOwnerCommand,
} = require('../utils/slashCommand');
const { retryWithBackoff } = require('../utils/retry');

function getFilesRecursive(dir) {
    if (!fs.existsSync(dir)) return [];

    const results = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...getFilesRecursive(fullPath));
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
            results.push(fullPath);
        }
    }
    return results;
}

function loadCommands(rootDir, folders = ['commands']) {
    const commands = new Collection();
    for (const folder of folders) {
        for (const filePath of getFilesRecursive(path.join(rootDir, folder))) {
            try {
                const command = require(filePath);
                if (command && typeof command.name === 'string' && typeof command.execute === 'function') {
                    commands.set(command.name, command);
                }
            } catch (error) {
                console.error(`Failed to load command file ${filePath}:`, error);
            }
        }
    }
    return { commands };
}

function shouldResetSlashCommands(args = process.argv.slice(2), envValue = process.env.SLASH_RESET) {
    return args.includes('--reset') || /^(true|1|yes)$/i.test(envValue || '');
}

async function synchronizeSlashCommands(commandManager, commands, { guildId, reset = false } = {}) {
    const slashCommands = [];
    const ownerCommandNames = new Set();
    const desiredCommandNames = new Set();
    for (const command of commands.values()) {
        if (isOwnerCommand(command)) {
            if (typeof command.name === 'string') ownerCommandNames.add(command.name.toLowerCase());
            continue;
        }

        const validationError = getSlashCommandValidationError(command);
        if (validationError) {
            if (command.show !== false) {
                console.warn(`[SLASH] Skipping '${command.name || 'unknown'}': ${validationError}`);
            }
            continue;
        }
        desiredCommandNames.add(command.name.toLowerCase());
        slashCommands.push({ command, data: buildSlashCommand(command) });
    }

    const scope = guildId ? `guild ${guildId}` : 'global';
    console.log(`[SLASH] Fetching existing ${scope} commands...`);
    const registeredCommands = await commandManager.fetch(guildId ? { guildId } : undefined);
    console.log(`[SLASH] Found ${registeredCommands.size} existing commands.`);
    let deleted = 0;

    if (reset) {
        console.log(`[SLASH] Deleting existing ${scope} commands...`);
        for (const registered of registeredCommands.values()) {
            await commandManager.delete(registered.id, guildId);
            deleted += 1;
        }
        registeredCommands.clear();
        console.log(`[SLASH] Deleted ${deleted} existing commands`);
    }

    for (const registered of registeredCommands.values()) {
        if (!ownerCommandNames.has(registered.name)
            && desiredCommandNames.has(registered.name)) continue;
        await commandManager.delete(registered.id, guildId);
        registeredCommands.delete(registered.id);
        deleted += 1;
        console.log(`[SLASH] Removed obsolete command /${registered.name}.`);
    }

    let created = 0;
    let updated = 0;
    for (const { data } of slashCommands) {
        const registered = registeredCommands.find(item => item.name === data.name);
        if (!registered) {
            console.log(`\n[CAUTIONS] This action will take some minutes, stay tuned\n`);
            console.log(`[SLASH] Creating /${data.name}...`);
            await commandManager.create(data, guildId);
            created += 1;
            continue;
        }

        if (getSlashCommandSignature(registered) !== getSlashCommandSignature(data)) {
            console.log(`[SLASH] Updating /${data.name}...`);
            await commandManager.edit(registered.id, data, guildId);
            updated += 1;
        }
    }

    const result = { total: slashCommands.length, created, updated, deleted, reset };
    console.log(`[SLASH] Checked ${slashCommands.length} commands${guildId ? ` in guild ${guildId}` : ' globally'}: ${created} created, ${updated} updated.`);
    return result;
}

function createSlashCommandManager(rest, applicationId, guildId) {
    const commandsRoute = guildId
        ? Routes.applicationGuildCommands(applicationId, guildId)
        : Routes.applicationCommands(applicationId);
    const commandRoute = commandId => guildId
        ? Routes.applicationGuildCommand(applicationId, guildId, commandId)
        : Routes.applicationCommand(applicationId, commandId);

    return {
        async fetch() {
            const commands = await rest.get(commandsRoute);
            return new Collection(commands.map(command => [command.id, command]));
        },
        delete: commandId => rest.delete(commandRoute(commandId)),
        create: data => rest.post(commandsRoute, { body: data }),
        edit: (commandId, data) => rest.patch(commandRoute(commandId), { body: data }),
    };
}

async function runSlashRegister({ reset = shouldResetSlashCommands() } = {}) {
    const token = process.env.DISCORD_BOT_API_KEY;
    if (!token) throw new Error('DISCORD_BOT_API_KEY is required to register slash commands.');

    console.log('[SLASH] Loading command modules...');
    const { commands } = loadCommands(path.resolve(__dirname, '..'));
    console.log(`[SLASH] Loaded ${commands.size} command modules.`);

    const rest = new REST({ version: '10', timeout: 20_000, retries: 0 }).setToken(token);

    console.log('[SLASH] Fetching application details (REST only; no bot Gateway login)...');
    const application = await retryWithBackoff(
        () => rest.get(Routes.oauth2CurrentApplication()),
        {
            initialDelayMs: 1_000,
            maxDelayMs: 5_000,
            maxAttempts: 3,
            shouldRetry: error => error.status !== 401 && error.status !== 403,
            onRetry: (error, attempt, delayMs) => {
                console.error(`[SLASH] REST attempt ${attempt} failed: ${error.message}`);
                console.warn(`[SLASH] Retrying in ${Math.ceil(delayMs / 1000)} seconds (maximum 3 attempts).`);
            },
        });
    console.log(`[SLASH] Connected to application ${application.id}.`);

    const commandManager = createSlashCommandManager(rest, application.id, process.env.SLASH_GUILD_ID || undefined);
    const result = await synchronizeSlashCommands(commandManager, commands, {
        guildId: process.env.SLASH_GUILD_ID || undefined,
        reset,
    });
    console.log(`[SLASH] Completed: ${result.total} valid commands.`);
    return result;
}

if (require.main === module) {
    runSlashRegister().catch(error => {
        console.error('[SLASH] Registration failed:', error);
        process.exitCode = 1;
    });
}

module.exports = { createSlashCommandManager, runSlashRegister, shouldResetSlashCommands, synchronizeSlashCommands };
