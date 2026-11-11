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

    async function connectData(bot, state, db) {
        try {
            await initializeDatabase(bot, state, db);
        } catch (error) {
            if (state.isShuttingDown) return;
            console.error('Error initializing Telegram bot:', error);
            process.exit(1);
        }
    }

    module.exports = { connectData };
}, {'./databaseHandler': databaseHandlerModule});

const commandHandlerModule = defineInlineModule((require, module, exports) => {
    const path = require('node:path');
    const { chatThreads } = require('./Adapter');
    const { loadCommands: loadPlatformCommands } = require('./commandLoader');

    function loadCommands(bot) {
        return loadPlatformCommands(bot, {
            directory: path.join(__dirname, 'commands'),
            platform: 'TELEGRAM',
            logLoaded: false,
        });
    }

    function registerCommandHandlers(bot, state, activeCommands) {
        const executeCommand = (command, ctx, commandText) => {
            const args = commandText.trim().split(/\s+/).slice(1);
            const commandPromise = Promise.resolve()
                .then(() => command.execute(bot, ctx, args, state, activeCommands))
                .catch(async error => {
                    console.error(`[COMMAND] Command '${command.name}' failed:`, error);
                    await ctx.reply(`Command failed: ${error.message}`).catch(replyError => {
                        console.error('[COMMAND] Failed to report command error:', replyError);
                    });
                });
            activeCommands.add(commandPromise);
            commandPromise.finally(() => activeCommands.delete(commandPromise));
        };

        const registeredCommands = new Map(bot.commands);
        for (const [alias, command] of bot.aliases) {
            if (!registeredCommands.has(alias)) registeredCommands.set(alias, command);
        }
        for (const [name, command] of registeredCommands) {
            bot.command(name, ctx => {
                if (state.isShuttingDown || !ctx.message?.text) return;
                executeCommand(command, ctx, ctx.message.text);
            });
        }

        bot.on('text', async (ctx) => {
            const msg = ctx.message;
            if (state.isShuttingDown || !msg || !msg.text) return;
            if (msg.text.startsWith('/')) return;

            try {
                const homeChat = await bot.db.getTelegramHomeChat();
                if (homeChat && String(msg.chat.id) !== homeChat) return;
            } catch (error) {
                console.error('[HOME] Failed to read configured Telegram home chat:', error);
                return;
            }
            // Cơ chế trò chuyện: Nếu không phải lệnh, gửi prompt tới AI
            const chatPromise = chatThreads.respondToUser(bot, ctx, msg.text);
            activeCommands.add(chatPromise);
            chatPromise.finally(() => activeCommands.delete(chatPromise));
        });
    }

    module.exports = { registerCommandHandlers, loadCommands };
}, {'./Adapter': adapterModule, './commandLoader': commandLoaderModule});

const SlashRegisterModule = defineInlineModule((require, module, exports) => {
    require('dotenv').config();

    const { Telegraf } = require('telegraf');
    const { loadCommands } = require('./CommandHandler');

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
}, {'./CommandHandler': commandHandlerModule});

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
            platform: 'TELEGRAM',
            stopClient: bot => {
                if (bot.polling || bot.webhookServer) bot.stop();
            },
        });
    }

    module.exports = { registerShutdownHandlers };
}, {'./runtimeLifecycleHandler': runtimeLifecycleHandlerModule});

module.exports = {
    ...commandHandlerModule,
    database: databaseModule,
    connectData: databaseModule.connectData,
    initializeDatabase: databaseHandlerModule.initializeDatabase,
    retry: retryModule,
    sessionCommands: sessionCommandsModule,
    slashRegister: SlashRegisterModule,
    synchronizeTelegramCommands: SlashRegisterModule.synchronizeTelegramCommands,
    runCommandRegister: SlashRegisterModule.runCommandRegister,
    lifecycle: lifecycleHandlerModule,
    registerShutdownHandlers: lifecycleHandlerModule.registerShutdownHandlers,
};
