const { SlashCommandBuilder } = require('discord.js');

function isOwnerCommand(command) {
    return Array.isArray(command?.category)
        ? command.category.includes('owner')
        : command?.category === 'owner';
}

function getSlashCommandValidationError(command) {
    if (!command || typeof command !== 'object') return 'command must be an object';
    if (typeof command.name !== 'string' || !/^[a-z0-9_-]{1,32}$/.test(command.name)) {
        return 'name must contain only lowercase letters, numbers, underscores, or hyphens';
    }
    if (typeof command.execute !== 'function') return 'execute must be a function';
    if (isOwnerCommand(command)) return 'owner commands are prefix-only';
    if (command.prefixOnly) return 'command is prefix-only';
    if (command.show === false) return 'command is hidden';

    if (command.slashOptions !== undefined) {
        if (!Array.isArray(command.slashOptions) || command.slashOptions.length > 25) {
            return 'slashOptions must be an array with no more than 25 options';
        }

        const names = new Set();
        const supportedTypes = new Set(['string', 'integer', 'number', 'boolean', 'user']);
        for (const option of command.slashOptions) {
            if (!option || typeof option.name !== 'string' || !/^[a-z0-9_-]{1,32}$/.test(option.name)) {
                return 'every slash option needs a valid lowercase name';
            }
            if (names.has(option.name)) return `duplicate slash option name '${option.name}'`;
            if (!supportedTypes.has(option.type || 'string')) return `unsupported slash option type '${option.type}'`;
            names.add(option.name);
        }
    }

    return null;
}

function buildSlashCommand(command) {
    const description = String(command.description || `Run the ${command.name} command.`).slice(0, 100);
    const slashOptions = Array.isArray(command.slashOptions) ? command.slashOptions : [];

    const builder = new SlashCommandBuilder()
        .setName(command.name.toLowerCase())
        .setDescription(description)
        .setDMPermission(command.DMs !== false);

    for (const option of [...slashOptions].sort((first, second) => Number(second.required) - Number(first.required))) {
        const optionType = option.type || 'string';
        const addOption = {
            string: 'addStringOption',
            integer: 'addIntegerOption',
            number: 'addNumberOption',
            boolean: 'addBooleanOption',
            user: 'addUserOption',
        }[optionType];

        if (!addOption) continue;

        builder[addOption](optionBuilder => optionBuilder
            .setName(option.name)
            .setDescription(String(option.description || `The ${option.name} option.`).slice(0, 100))
            .setRequired(Boolean(option.required)));
    }

    return builder.toJSON();
}

function getSlashCommandSignature(command) {
    const definition = typeof command.toJSON === 'function' ? command.toJSON() : command;
    const ignoredDefaults = new Set(['required', 'autocomplete', 'nsfw', 'dm_permission']);

    const normalize = (value) => {
        if (Array.isArray(value)) return value.map(normalize);
        if (!value || typeof value !== 'object') return value;

        const normalized = {};
        for (const key of Object.keys(value).sort()) {
            const entry = value[key];
            if (entry === undefined || entry === null) continue;
            if (ignoredDefaults.has(key) && entry === (key === 'dm_permission')) continue;
            if (key === 'integration_types' && Array.isArray(entry) && entry.length === 2 && entry[0] === 0 && entry[1] === 1) continue;
            if (key === 'options' && Array.isArray(entry) && entry.length === 0) continue;
            if (key === 'id' || key === 'application_id' || key === 'version') continue;
            normalized[key] = normalize(entry);
        }
        return normalized;
    };

    return JSON.stringify(normalize(definition));
}

module.exports = {
    buildSlashCommand,
    getSlashCommandSignature,
    getSlashCommandValidationError,
    isOwnerCommand,
};