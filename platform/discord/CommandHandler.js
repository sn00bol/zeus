function defineInlineModule(factory, dependencies = {}) {
    const module = { exports: {} };
    const inlineRequire = name => {
        if (Object.hasOwn(dependencies, name)) return dependencies[name];
        if (name.startsWith('.')) throw new Error(`Unknown inline dependency: ${name}`);
        return require(name);
    };
    inlineRequire.main = null;
    factory(inlineRequire, module, module.exports);
    return module.exports;
}

const adapterModule = require('./Adapter');

const commandLoaderModule = defineInlineModule((require, module, exports) => {
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
}, {});

const retryModule = defineInlineModule((require, module, exports) => {
    const defaultSleep = delayMs => new Promise(resolve => setTimeout(resolve, delayMs));

    async function retryWithBackoff(operation, options = {}) {
        const {
            initialDelayMs = 1_000,
            maxDelayMs = 60_000,
            maxAttempts = Number.POSITIVE_INFINITY,
            shouldRetry = () => true,
            onRetry = () => {},
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
}, {});

const slashCommandModule = defineInlineModule((require, module, exports) => {
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
}, {});

const NavigateManagerModule = defineInlineModule((require, module, exports) => {
    const { ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

    const getOptions = () => {
        // Help.js
        const options = [
            { label: 'All', value: 'all', description: 'View all available commands' },
        ];
        options.push({ label: 'Unknown', value: 'gau3' });
        return options;
    };

    // Select Options
    const getMenuRow = (customId, customOptions = null, maxValues = 1, minValues = 1) => {
        const options = customOptions || getOptions();
        return new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(customId)
                .setPlaceholder('Select a category')
                .setMinValues(minValues)
                .setMaxValues(maxValues)
                .addOptions(options)
        );
    };

    const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

    const createFastNavigateModal = (totalPages, customId = 'fast_navigate_modal') => {
        return new ModalBuilder()
            .setCustomId(customId)
            .setTitle('Fast Navigate')
            .addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('page_input')
                        .setLabel(`Enter a page from 1 to ${totalPages}`)
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder(`1 - ${totalPages}`)
                        .setRequired(true)
                        .setMinLength(1)
                        .setMaxLength(String(totalPages).length)
                )
            );
    };

        const getReloadButton = (customId = 'reload', disabled = false) => {
            return new ButtonBuilder()
                .setCustomId(customId)
                .setEmoji('🔄')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(disabled);
        };

    const getPaginationRow = (currentPage, totalPages, options = {}) => {
        const includeFastNavigate = options.includeFastNavigate || false;
            const includeReload = options.includeReload || false;

        const components = [
            new ButtonBuilder()
                .setCustomId('first')
                .setEmoji('⏮')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentPage === 0),
            new ButtonBuilder()
                .setCustomId('prev')
                .setEmoji('◀')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentPage === 0),
        ];

        if (includeFastNavigate) {
            components.push(
                new ButtonBuilder()
                    .setCustomId('fast_navigate')
                    .setEmoji('⏩')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(totalPages <= 1)
            );
        }

        if (includeReload) {
            components.push(getReloadButton(options.reloadCustomId || 'reload'));
        }

        components.push(
            new ButtonBuilder()
                .setCustomId('next')
                .setEmoji('▶')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentPage >= totalPages - 1 || totalPages === 0),
            new ButtonBuilder()
                .setCustomId('last')
                .setEmoji('⏭')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentPage >= totalPages - 1 || totalPages === 0)
        );

        return new ActionRowBuilder().addComponents(components);
    };

    const applySelectMenuDefaults = (options, selectedValues) => {
        if (!selectedValues) return options;
        const selectedArray = Array.isArray(selectedValues) ? selectedValues : [selectedValues];
        return options.map(opt => ({
            ...opt,
            default: selectedArray.includes(opt.value)
        }));
    };

    module.exports = { getOptions, getMenuRow, getPaginationRow, getReloadButton, applySelectMenuDefaults, createFastNavigateModal };
}, {});

const permissionModule = defineInlineModule((require, module, exports) => {
    require('dotenv').config();

    // Parse comma-separated OWNER_ID from environment variables
    const ownerIds = process.env.OWNER_ID
        ? process.env.OWNER_ID.split(',').map(id => id.trim()).filter(id => id.length > 0)
        : [];

    /**
     * Check if the given user ID belongs to one of the bot owners.
     * @param {string} userId
     * @returns {boolean}
     */
    function isOwner(userId) {
        return ownerIds.includes(userId);
    }

    module.exports = {
        isOwner,
        ownerIds
    };
}, {});

const presenceHandlerModule = defineInlineModule((require, module, exports) => {
    const { ActivityType } = require('discord.js');

    function startPresence(client) {
        const updateStatus = () => {
            const serverCount = client.guilds.cache.size;
            client.user.setPresence({
                status: 'online',
                activities: [{
                    name: `Serving ${serverCount} servers!`,
                    type: ActivityType.Streaming,
                    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
                }],
            });
        };

        updateStatus();
        return setInterval(updateStatus, 5 * 60 * 1000);
    }

    module.exports = { startPresence };
}, {});

const sessionCommandsModule = defineInlineModule((require, module, exports) => {
    const { requestJson } = require('./agentBridge');

    function conversationPath(path, platform, conversationId) {
        const query = new URLSearchParams({
            platform,
            conversation_id: String(conversationId),
        });
        return `${path}?${query}`;
    }

    async function getConversationUsage(platform, conversationId) {
        return requestJson(conversationPath('/sessions/usage', platform, conversationId));
    }

    async function getRetryPrompt(platform, conversationId) {
        return requestJson(conversationPath('/sessions/retry', platform, conversationId));
    }

    async function getConversationStatus(platform, conversationId) {
        return requestJson(conversationPath('/status', platform, conversationId));
    }

    async function resetConversation(platform, conversationId) {
        return requestJson('/sessions/reset', {
            method: 'POST',
            body: {
                platform,
                conversation_id: String(conversationId),
            },
        });
    }

    module.exports = {
        getConversationUsage,
        getRetryPrompt,
        getConversationStatus,
        resetConversation,
    };
}, {'./agentBridge': adapterModule.bridge});

const databaseHandlerModule = defineInlineModule((require, module, exports) => {
    async function initializeDatabase(client, state, dbmanager) {
        await dbmanager.init();

        if (state.isShuttingDown) {
            await dbmanager.close();
            return false;
        }

        client.db = dbmanager;
        state.databasesReady = true;
        return true;
    }

    module.exports = { initializeDatabase };
}, {});

const databaseModule = defineInlineModule((require, module, exports) => {
    const { initializeDatabase } = require('./databaseHandler');
    const { retry: { retryWithBackoff } } = require('./Adapter');

    async function connectData(client, state, db) {
        try {
            if (!await initializeDatabase(client, state, db)) return;

            await retryWithBackoff(async () => {
                const token = process.env.DISCORD_BOT_API_KEY;
                if (!token) {
                    throw new Error('DISCORD_BOT_API_KEY is missing in .env file');
                }
                return await client.login(token);
            }, {
                initialDelayMs: 5000,
                maxDelayMs: 60000,
                shouldRetry: (error) => {
                    if (state.isShuttingDown) return false;
                    if (error.code === 'TokenInvalid' || error.code === 'TokenMissing' || error.status === 401) {
                        console.error('[LOGIN] Critical error: Invalid token. Please check your .env file.');
                        return false;
                    }
                    return true;
                },
                onRetry: (error, attempt, delayMs) => {
                    console.error(`[LOGIN] Discord connection attempt ${attempt} failed: ${error.message}`);
                    console.warn(`[LOGIN] Retrying in ${Math.ceil(delayMs / 1000)} seconds.`);
                },
            });
        } catch (error) {
            if (state.isShuttingDown) return;
            console.error('Error initializing bot:', error);
            process.exit(1);
        }
    }

    module.exports = { connectData };
}, {'./databaseHandler': databaseHandlerModule, './Adapter': { ...adapterModule, retry: retryModule }});

const commandHandlerModule = defineInlineModule((require, module, exports) => {
    const path = require('node:path');
    const { ChannelType, Collection } = require('discord.js');
    const { chatThreads, permission } = require('./Adapter');
    const { loadCommands: loadPlatformCommands } = require('./commandLoader');

    async function startMentionChat(client, message, prompt) {
        if (!prompt) {
            await message.reply({
                content: 'Include a question or message after mentioning ZEUS to start a chat thread.',
                allowedMentions: { repliedUser: false },
            });
            return;
        }

        try {
            const thread = await chatThreads.createChatThread(client, message, { prompt });
            await chatThreads.respondInChatThread(client, message, {
                guild_id: message.guildId,
            }, prompt, thread);
        } catch (error) {
            await message.reply({
                content: `Could not create a chat thread. Check that the bot can create public threads: ${error.message}`,
                allowedMentions: { repliedUser: false },
            }).catch(replyError => {
                console.error('[CHAT] Failed to report thread creation error:', replyError);
            });
            return;
        }
    }

    function loadCommands(client) {
        client.blockedCommands = new Set();
        return loadPlatformCommands(client, {
            directory: path.join(__dirname, 'commands'),
            collectionFactory: () => new Collection(),
            platform: 'DISCORD',
        });
    }

    async function runCommand(client, command, context, args) {
        const user = context.user || context.author;
        if (context.isChatInputCommand?.() && command.deferReply && !context.deferred && !context.replied) {
            try {
                await context.deferReply(
                    typeof command.deferReply === 'object' ? command.deferReply : undefined,
                );
            } catch (error) {
                console.error(`[DISCORD] Failed to defer '${command.name}' interaction:`, error);
                return;
            }
        }

        try {
            await client.db.ensureDefaultUserSettings(user.id);
        } catch (error) {
            console.error('[SETTINGS] Failed to apply user settings:', error);
        }

        client.db.recordUserActivity(user.id).catch(error => {
            console.error('[ACTIVITY] Failed to record command usage:', error);
        });


        if (client.blockedCommands.has(command.name)) {
            const blockedMessage = 'This command currently blocked due to a bugs or crashing, will fix it fast as possible';
            if (context.isChatInputCommand?.()) {
                return context.reply({ content: blockedMessage, ephemeral: true });
            }
            return context.reply(blockedMessage);
        }

        try {
            if (context.isChatInputCommand?.()) {
                await command.execute(context);
            } else {
                await command.execute(context, args);
            }
        } catch (error) {
            console.error(`[ERROR] Command '${command.name}' failed and is now blocked:`, error);
            client.blockedCommands.add(command.name);
            const errorMessage = 'This command currently blocked due to a bugs or crashing, will fix it fast as possible';
            if (context.isChatInputCommand?.()) {
                if (context.deferred) {
                    await context.editReply({ content: errorMessage, embeds: [], components: [] });
                } else if (context.replied) {
                    await context.followUp({ content: errorMessage, ephemeral: true });
                } else {
                    await context.reply({ content: errorMessage, ephemeral: true });
                }
            } else {
                await context.reply(errorMessage);
            }
        }
    }

    function trackCommand(client, activeCommands, command, context, args) {
        const commandPromise = runCommand(client, command, context, args);
        activeCommands.add(commandPromise);
        return commandPromise.finally(() => activeCommands.delete(commandPromise));
    }

    function getMessageCommandPrefix(value = process.env.PFX) {
        const prefix = String(value || '').trim();
        return prefix && prefix !== 'YOUR_BOT_PREFIX' ? prefix : null;
    }

    function registerCommandHandlers(client, state, activeCommands) {
        loadCommands(client);
        const prefix = getMessageCommandPrefix();

        client.on('messageCreate', async message => {
            if (state.isShuttingDown || message.author.bot) return;

            const botId = client.user?.id;
            if (message.guild && botId && message.mentions.has(botId) && !message.channel.isThread?.()) {
                let homeChannel;
                try {
                    homeChannel = await client.db.getHomeChannel(message.guildId);
                } catch (error) {
                    console.error('[HOME] Failed to read configured home channel:', error);
                    return;
                }
                if (homeChannel && message.channelId !== homeChannel) return;
                const prompt = chatThreads.getPromptWithoutBotMention(message, botId);
                if (typeof message.startThread !== 'function') {
                    await message.reply({
                        content: 'Mention ZEUS in a server text channel to start a chat thread.',
                        allowedMentions: { repliedUser: false },
                    });
                    return;
                }
                await startMentionChat(client, message, prompt);
                return;
            }

            const isCommand = prefix !== null && message.content.startsWith(prefix);
            if (!isCommand) {
                let chatThread = null;
                try {
                    if (message.channel.isThread?.()) {
                        if ([ChannelType.PublicThread, ChannelType.AnnouncementThread].includes(message.channel.type)) {
                            chatThread = await client.db.getChatThread(message.channelId);
                        }
                    }
                    if (!chatThread) {
                        await client.db.appendMessage({
                            platform: 'discord',
                            conversation_id: message.channelId,
                            message_id: message.id,
                            role: 'user',
                            content: message.content,
                            user_id: message.author.id,
                            username: message.author.username,
                            channel_id: message.channelId,
                            guild_id: message.guildId,
                            timestamp: message.createdAt.toISOString(),
                        });
                    }
                } catch (error) {
                    console.error('[HISTORY] Failed to store Discord message:', error);
                    return;
                }

                if (chatThread) {
                    const prompt = botId && message.mentions.has(botId)
                        ? chatThreads.getPromptWithoutBotMention(message, botId)
                        : message.content;
                    await chatThreads.respondInChatThread(client, message, chatThread, prompt || message.content);
                }
                return;
            }

            const args = message.content.slice(prefix.length).trim().split(/ +/);
            const commandName = args.shift().toLowerCase();
            const command = client.commands.get(commandName) || client.aliases.get(commandName);
            if (command && (message.guild || command.DMs !== false)) {
                if (command.ownerOnly && !permission.isOwner(message.author.id)) {
                    await message.reply('This command is restricted to the bot owner.');
                    return;
                }
                await trackCommand(client, activeCommands, command, message, args);
            }
        });

        client.on('interactionCreate', async interaction => {
            if (state.isShuttingDown || !interaction.isChatInputCommand() || interaction.user.bot) return;

            const command = client.commands.get(interaction.commandName);
            if (!command) {
                return interaction.reply({ content: 'This slash command is no longer available.', ephemeral: true });
            }
            if (!interaction.guild && command.DMs === false) {
                return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
            }
            await trackCommand(client, activeCommands, command, interaction);
        });
    }

    module.exports = { getMessageCommandPrefix, loadCommands, registerCommandHandlers };
}, {'./Adapter': { ...adapterModule, permission: permissionModule }, './commandLoader': commandLoaderModule});

const SlashRegisterModule = defineInlineModule((require, module, exports) => {
    require('dotenv').config();

    const path = require('path');
    const { Collection, REST, Routes } = require('discord.js');
    const { loadCommands: loadSharedCommands } = require('./commandLoader');
    const { retry, slashCommand } = require('./Adapter');
    const {
        buildSlashCommand,
        getSlashCommandSignature,
        getSlashCommandValidationError,
        isOwnerCommand,
    } = slashCommand;
    const { retryWithBackoff } = retry;

    function loadCommands(rootDir, folders = ['commands']) {
        const commands = new Collection();
        for (const folder of folders) {
            loadSharedCommands({ commands, aliases: new Collection() }, {
                directory: path.join(rootDir, folder),
                collectionFactory: () => commands,
                platform: 'DISCORD SLASH',
            });
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
        const { commands } = loadCommands(path.resolve(__dirname));
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
}, {'./commandLoader': commandLoaderModule, './Adapter': { ...adapterModule, retry: retryModule, slashCommand: slashCommandModule }});

const runtimeLifecycleHandlerModule = defineInlineModule((require, module, exports) => {
    function registerShutdownHandlers({
        platform,
        client,
        state,
        healthServer,
        activeCommands,
        dbmanager,
        stopClient,
    }) {
        async function shutdown(signal) {
            if (state.shutdownPromise) return state.shutdownPromise;
            state.isShuttingDown = true;
            state.databasesReady = false;
            if ('botReady' in state) state.botReady = false;
            console.log(`[SHUTDOWN] Received ${signal}; closing ${platform} bot resources.`);

            if (state.presenceInterval) clearInterval(state.presenceInterval);

            state.shutdownPromise = (async () => {
                const pendingCommands = Promise.allSettled([...activeCommands]);
                const healthServerClosed = healthServer && healthServer.listening
                    ? new Promise(resolve => healthServer.close(resolve))
                    : Promise.resolve();
                const commandResults = await Promise.allSettled([
                    pendingCommands,
                    healthServerClosed,
                ]);

                await stopClient(client);

                const databaseResults = await Promise.allSettled([dbmanager.close()]);
                const failures = [...commandResults, ...databaseResults]
                    .filter(result => result.status === 'rejected');
                if (failures.length > 0) {
                    failures.forEach(result => {
                        console.error('[SHUTDOWN] Resource close failed:', result.reason);
                    });
                    process.exitCode = 1;
                }
            })();

            return state.shutdownPromise;
        }

        for (const signal of ['SIGINT', 'SIGTERM']) {
            process.once(signal, () => {
                shutdown(signal).catch(error => {
                    console.error('[SHUTDOWN] Failed to stop cleanly:', error);
                    process.exitCode = 1;
                });
            });
        }

        return shutdown;
    }

    module.exports = { registerShutdownHandlers };
}, {});

const lifecycleHandlerModule = defineInlineModule((require, module, exports) => {
    const { registerShutdownHandlers: registerSharedShutdownHandlers } = require('./runtimeLifecycleHandler');

    function registerShutdownHandlers(options) {
        return registerSharedShutdownHandlers({
            ...options,
            platform: 'DISCORD',
            stopClient: client => client.destroy(),
        });
    }

    module.exports = { registerShutdownHandlers };
}, {'./runtimeLifecycleHandler': runtimeLifecycleHandlerModule});

const commandInteractionModule = defineInlineModule((require, module, exports) => {
    const repliedInteractions = new WeakSet();

    function interactionPayload(payload) {
        if (typeof payload === 'string') return { content: payload, fetchReply: true };
        return { ...payload, fetchReply: true };
    }

    function getCommandUser(context) {
        return context.user || context.author;
    }

    async function replyToCommand(context, payload) {
        if (!context.isChatInputCommand?.()) return context.reply(payload);

        if (context.deferred && !repliedInteractions.has(context)) {
            repliedInteractions.add(context);
            return context.editReply(payload);
        }
        repliedInteractions.add(context);
        if (context.replied || context.deferred) return context.followUp(interactionPayload(payload));
        return context.reply(interactionPayload(payload));
    }

    async function sendCommandMessage(context, payload) {
        if (!context.isChatInputCommand?.()) {
            return context.channel.send(payload);
        }

        if (context.deferred && !repliedInteractions.has(context)) {
            repliedInteractions.add(context);
            await context.editReply(payload);
            return context.fetchReply();
        }
        if (context.replied || context.deferred) return context.channel.send(payload);

        repliedInteractions.add(context);
        await context.reply(interactionPayload(payload));
        return context.fetchReply();
    }

    module.exports = { getCommandUser, replyToCommand, sendCommandMessage };
}, {});

module.exports = {
    ...commandHandlerModule,
    database: databaseModule,
    connectData: databaseModule.connectData,
    initializeDatabase: databaseHandlerModule.initializeDatabase,
    retry: retryModule,
    slashCommand: slashCommandModule,
    navigation: NavigateManagerModule,
    permission: permissionModule,
    commandInteraction: commandInteractionModule,
    presence: presenceHandlerModule,
    startPresence: presenceHandlerModule.startPresence,
    sessionCommands: sessionCommandsModule,
    slashRegister: SlashRegisterModule,
    runSlashRegister: SlashRegisterModule.runSlashRegister,
    lifecycle: lifecycleHandlerModule,
    registerShutdownHandlers: lifecycleHandlerModule.registerShutdownHandlers,
};
