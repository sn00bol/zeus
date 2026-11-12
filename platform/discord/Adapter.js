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

const agentBridgeModule = defineInlineModule((require, module, exports) => {
    const http = require('node:http');
    const https = require('node:https');

    function requestJson(path, { method = 'GET', body, timeoutMs = 10_000 } = {}) {
        const bridgeUrl = new URL(process.env.BRIDGE_URL || 'http://127.0.0.1:5000');
        const transport = bridgeUrl.protocol === 'https:' ? https : http;
        const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
        const headers = {};
        const bridgeToken = String(process.env.BRIDGE_TOKEN || '').trim();
        if (payload) {
            headers['Content-Type'] = 'application/json';
            headers['Content-Length'] = payload.length;
        }
        if (bridgeToken) headers.Authorization = `Bearer ${bridgeToken}`;

        return new Promise((resolve, reject) => {
            const request = transport.request(new URL(path, bridgeUrl), {
                method,
                headers,
            }, response => {
                const chunks = [];
                response.on('data', chunk => chunks.push(chunk));
                response.on('error', reject);
                response.on('end', () => {
                    let data;
                    try {
                        data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                    } catch (error) {
                        reject(new Error(`Bridge returned invalid JSON: ${error.message}`));
                        return;
                    }

                    if (response.statusCode < 200 || response.statusCode >= 300) {
                        reject(new Error(data.error || `Bridge request failed (${response.statusCode}).`));
                        return;
                    }
                    resolve(data);
                });
            });

            request.setTimeout(timeoutMs, () => {
                request.destroy(new Error(`Bridge request timed out after ${timeoutMs}ms.`));
            });
            request.on('error', reject);
            if (payload) request.write(payload);
            request.end();
        });
    }

    module.exports = { requestJson };
}, {});

const messageChunksModule = require('../messageChunks');

const runtimeAgentConversationModule = defineInlineModule((require, module, exports) => {
    const { requestJson } = require('./agentBridge');

    const POLL_INTERVAL_MS = 1_000;
    const RUN_TIMEOUT_MS = 14 * 60 * 1_000;
    const PROVIDERS = new Set(['ollama', 'lmstudio', 'llamacpp']);

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function getModelScope(platform, guildId, userId) {
        if (platform === 'telegram') return `telegram:user:${userId}`;
        if (platform === 'discord') {
            return guildId ? `discord:guild:${guildId}` : `discord:user:${userId}`;
        }
        throw new TypeError(`Unsupported conversation platform: ${platform}`);
    }

    function getEnvironmentModelSelection(models) {
        const configuredProvider = String(process.env.ZEUS_PROVIDER || '').trim().toLowerCase();
        if (configuredProvider && !PROVIDERS.has(configuredProvider)) {
            throw new Error(
                `Unsupported ZEUS_PROVIDER '${configuredProvider}'. Choose ollama, lmstudio, or llamacpp.`,
            );
        }
        const configuredModel = String(process.env.ZEUS_MODEL || '').trim();
        const modelIsAutomatic = ['auto', 'automatic'].includes(configuredModel.toLowerCase());

        if (configuredModel && !modelIsAutomatic) {
            const selected = models.find(item => (
                item.model === configuredModel
                && (!configuredProvider || item.provider === configuredProvider)
            ));
            if (!selected) {
                const providerLabel = configuredProvider ? ` under '${configuredProvider}'` : '';
                throw new Error(
                    `ZEUS_MODEL '${configuredModel}'${providerLabel} is not available. `
                    + 'Check ZEUS_MODEL and ZEUS_PROVIDER in .env.',
                );
            }
            return selected;
        }

        const selected = configuredProvider
            ? models.find(item => item.provider === configuredProvider)
            : models[0];
        if (!selected) {
            throw new Error(
                `No models are available from ZEUS_PROVIDER '${configuredProvider}'. `
                + 'Check that the provider is running and has a model loaded.',
            );
        }
        return selected;
    }

    async function selectModel(database, scopeId) {
        const preference = await database.getModelPreference(scopeId);
        if (preference?.provider && preference?.model) return preference;

        const { models } = await requestJson('/models');
        if (!Array.isArray(models) || models.length === 0) {
            throw new Error(
                'No AI models were discovered. Check that the selected provider is running, '
                + 'ZEUS_PROVIDER and LLM_PORT are correct, and that LLM_HOST is reachable '
                + 'from the bot. With Docker Compose, use host.docker.internal for a provider '
                + 'running on the host; Ollama must listen on a network-accessible interface.',
            );
        }
        return getEnvironmentModelSelection(models);
    }

    async function waitForRun(runId) {
        const deadline = Date.now() + RUN_TIMEOUT_MS;
        while (Date.now() < deadline) {
            const run = await requestJson(`/agent/runs/${encodeURIComponent(runId)}`);
            if (run.status === 'completed') return run.result;
            if (run.status === 'failed') throw new Error(run.error || 'The agent run failed.');
            await sleep(POLL_INTERVAL_MS);
        }
        throw new Error(`Agent run ${runId} is still running. Try again later.`);
    }

    async function generateConversationReply({
        client,
        platform,
        conversationId,
        guildId,
        userId,
        username,
        messageId,
        prompt,
        onQueued,
    }) {
        if (!['discord', 'telegram'].includes(platform)) {
            throw new TypeError(`Unsupported conversation platform: ${platform}`);
        }
        const { db } = client;
        const scopeId = getModelScope(platform, guildId, userId);
        const normalizedConversationId = String(conversationId);
        const normalizedUserId = String(userId);
        await db.appendMessage({
            platform,
            conversation_id: normalizedConversationId,
            message_id: String(messageId),
            role: 'user',
            content: prompt,
            user_id: normalizedUserId,
            username,
            channel_id: normalizedConversationId,
            guild_id: platform === 'discord' ? guildId || null : null,
            timestamp: new Date().toISOString(),
        });

        const history = await db.getMessages({
            platform,
            conversationId: normalizedConversationId,
            limit: 20,
        });
        const selection = await selectModel(db, scopeId);
        const metadata = { channel_id: normalizedConversationId };
        if (platform === 'discord') metadata.guild_id = guildId || null;

        const run = await requestJson('/agent/run', {
            method: 'POST',
            body: {
                provider: selection.provider,
                model: selection.model,
                platform,
                session: {
                    platform,
                    conversation_id: normalizedConversationId,
                    user_id: normalizedUserId,
                    metadata,
                },
                messages: history.map(message => ({
                    role: message.role,
                    content: message.content,
                })),
            },
        });
        if (onQueued) await onQueued(run);
        const result = await waitForRun(run.run_id);
        return {
            content: result.content,
            thinking: result.thinking || '',
            model: selection.model,
            provider: selection.provider,
            scopeId,
            promptTokens: result.prompt_tokens || 0,
            completionTokens: result.completion_tokens || 0,
        };
    }

    async function storeAssistantReply(client, {
        platform,
        conversationId,
        guildId,
        messageId,
        content,
        promptTokens = 0,
        completionTokens = 0,
    }) {
        if (!['discord', 'telegram'].includes(platform)) {
            throw new TypeError(`Unsupported conversation platform: ${platform}`);
        }
        const isDiscord = platform === 'discord';
        await client.db.appendMessage({
            platform,
            conversation_id: String(conversationId),
            message_id: String(messageId),
            role: 'assistant',
            content,
            usage: {
                prompt_tokens: promptTokens,
                completion_tokens: completionTokens,
            },
            user_id: isDiscord ? client.user?.id || 'zeus' : 'zeus',
            username: isDiscord ? client.user?.username || 'Zeus' : 'Zeus',
            channel_id: String(conversationId),
            guild_id: isDiscord ? guildId || null : null,
            timestamp: new Date().toISOString(),
        });
    }

    module.exports = {
        generateConversationReply,
        getEnvironmentModelSelection,
        getModelScope,
        selectModel,
        storeAssistantReply,
        waitForRun,
    };
}, {'./agentBridge': agentBridgeModule});

const agentConversationModule = defineInlineModule((require, module, exports) => {
    const shared = require('./runtimeAgentConversation');

    module.exports = {
        ...shared,
        getModelScope: (guildId, userId) => shared.getModelScope('discord', guildId, userId),
        generateConversationReply: options => shared.generateConversationReply({
            ...options,
            platform: 'discord',
        }),
        storeAssistantReply: (client, options) => shared.storeAssistantReply(client, {
            ...options,
            platform: 'discord',
        }),
    };
}, {'./runtimeAgentConversation': runtimeAgentConversationModule});

const chatThreadsModule = defineInlineModule((require, module, exports) => {
    const { ChannelType } = require('discord.js');
    const { splitMessage } = require('../messageChunks');
    const {
        generateConversationReply,
        storeAssistantReply,
    } = require('./agentConversation');

    function formatAgentResponse(result) {
        const content = String(result.content || '');
        const thinking = String(result.thinking || '').trim();
        if (!thinking) return content;

        const excerpt = thinking.length > 1_000
            ? `${thinking.slice(0, 999)}…`
            : thinking;
        return `||💭 ${excerpt}||\n\n${content}`;
    }

    function getPromptWithoutBotMention(message, botId) {
        return message.content.replace(new RegExp(`<@!?${botId}>`, 'g'), '').trim();
    }

    async function respondInChatThread(
        client,
        message,
        chatThread,
        prompt,
        channel = message.channel,
        { messageId = message.id, user = message.author, onQueued } = {},
    ) {
        try {
            const result = await generateConversationReply({
                client,
                conversationId: channel.id,
                guildId: chatThread.guild_id,
                userId: user.id,
                username: user.username,
                messageId,
                prompt,
                onQueued,
            });
            const response = formatAgentResponse(result);
            let sentMessage;
            for (const chunk of splitMessage(response)) {
                sentMessage = await channel.send(chunk);
            }
            try {
                await storeAssistantReply(client, {
                    conversationId: channel.id,
                    guildId: chatThread.guild_id,
                    messageId: sentMessage.id,
                    content: result.content,
                    promptTokens: result.promptTokens,
                    completionTokens: result.completionTokens,
                });
            } catch (error) {
                console.error('[HISTORY] Failed to store thread agent response:', error);
            }
            return { success: true, response, usage: result };
        } catch (error) {
            console.error('[CHAT] Failed to respond in ZEUS thread:', error);
            await channel.send(`ZEUS could not answer: ${error.message}`).catch(sendError => {
                console.error('[CHAT] Failed to report thread agent error:', sendError);
            });
            return { success: false, error };
        }
    }

    async function createChatThread(client, message, {
        prompt = '',
        name = '',
    } = {}) {
        const threadName = (name || prompt.replace(/\s+/g, ' ').slice(0, 100)
            || `zeus-${message.author.username}`).slice(0, 100);
        let thread;
        try {
            thread = await message.startThread({
                name: threadName,
                reason: `ZEUS chat requested by ${message.author.id}`,
            });
            if (![ChannelType.PublicThread, ChannelType.AnnouncementThread].includes(thread.type)) {
                throw new Error('ZEUS chat must use a public thread.');
            }
            await thread.members.add(message.author.id);
            await client.db.registerChatThread({
                threadId: thread.id,
                guildId: message.guildId,
                parentChannelId: message.channelId,
                ownerId: message.author.id,
            });
            return thread;
        } catch (error) {
            console.error('[CHAT] Failed to create ZEUS chat thread:', error);
            if (thread) {
                await client.db.removeChatThread(thread.id).catch(cleanupError => {
                    console.error('[CHAT] Failed to remove incomplete thread registration:', cleanupError);
                });
                await thread.delete('Failed to initialize ZEUS chat thread').catch(deleteError => {
                    console.error('[CHAT] Failed to remove incomplete thread:', deleteError);
                });
            }
            throw error;
        }
    }

    module.exports = {
        createChatThread,
        formatAgentResponse,
        getPromptWithoutBotMention,
        respondInChatThread,
        splitMessage,
    };
}, {
    '../messageChunks': messageChunksModule,
    './agentConversation': agentConversationModule,
});

const modelServiceModule = defineInlineModule((require, module, exports) => {
    const { requestJson } = require('./agentBridge');
    const { getEnvironmentModelSelection } = require('./runtimeAgentConversation');

    const PROVIDERS = new Set(['ollama', 'lmstudio', 'llamacpp']);

    async function fetchAvailableModels() {
        const { models } = await requestJson('/models');
        if (!Array.isArray(models)) {
            throw new Error('Bridge returned an invalid models list.');
        }
        return models;
    }

    async function getAvailableModels(database, scopeId) {
        const models = await fetchAvailableModels();
        const preference = await database.getModelPreference(scopeId);
        return { models, preference };
    }

    async function setPreferredModel(database, scopeId, provider, model) {
        const normalizedProvider = String(provider || '').toLowerCase();
        if (!PROVIDERS.has(normalizedProvider) || !model) {
            return { selected: null, reason: 'invalid-selection' };
        }

        const models = await fetchAvailableModels();
        const selected = models.find(item => item.provider === normalizedProvider && item.model === model);
        if (!selected) return { selected: null, reason: 'model-not-found' };

        await database.setModelPreference(scopeId, selected.provider, selected.model);
        return { selected };
    }

    async function setModelToAutomatic(database, scopeId) {
        await database.setModelPreference(scopeId, null, null);
    }

    module.exports = {
        getEnvironmentModelSelection,
        getAvailableModels,
        setModelToAutomatic,
        setPreferredModel,
    };
}, {
    './agentBridge': agentBridgeModule,
    './runtimeAgentConversation': runtimeAgentConversationModule,
});

const tokenFormatModule = defineInlineModule((require, module, exports) => {
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
}, {});

const statusSummaryModule = defineInlineModule((require, module, exports) => {
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
}, {'./tokenFormat': tokenFormatModule});

module.exports = {
    bridge: agentBridgeModule,
    chatThreads: chatThreadsModule,
    conversation: agentConversationModule,
    modelService: modelServiceModule,
    statusSummary: statusSummaryModule,
    tokenFormat: tokenFormatModule,
};
