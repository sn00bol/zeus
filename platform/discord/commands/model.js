const {
    getEnvironmentModelSelection,
    getAvailableModels,
    setModelToAutomatic,
    setPreferredModel,
} = require('../Adapter').modelService;
const { conversation } = require('../Adapter');
const { getModelScope } = conversation;
const { replyToCommand } = require('../CommandHandler').commandInteraction;

const ACTIONS = new Set(['list', 'set', 'auto']);
const MODEL_LIST_MESSAGE_LIMIT = 1_850;

function createModelListMessages(lines, footer) {
    const messages = [];
    const heading = '**Available models**';
    const continuedHeading = '**Available models (continued)**';
    let current = heading;
    for (const line of lines) {
        const next = `${current}\n${line}`;
        if (next.length > MODEL_LIST_MESSAGE_LIMIT) {
            if (current === heading || current === continuedHeading) {
                throw new Error('A model entry is too long to display.');
            }
            messages.push(current);
            current = continuedHeading;
        }
        current += `\n${line}`;
    }

    const finalMessage = `${current}\n\n${footer}`;
    if (finalMessage.length <= MODEL_LIST_MESSAGE_LIMIT) {
        messages.push(finalMessage);
    } else {
        messages.push(current);
        messages.push(`**Model selection**\n\n${footer}`);
    }
    return messages;
}

function getOptions(context, args) {
    if (context.isChatInputCommand?.()) {
        return {
            action: context.options.getString('action') || 'list',
            provider: context.options.getString('provider'),
            model: context.options.getString('model'),
        };
    }
    return {
        action: (args[0] || 'list').toLowerCase(),
        provider: args[1],
        model: args.slice(2).join(' '),
    };
}

module.exports = {
    name: 'model',
    description: 'List or select an available AI provider and model',
    usage: 'Zmodel [list|set <provider> <model>|auto]',
    deferReply: true,
    slashOptions: [
        { name: 'action', description: 'List, set, or use automatic model selection' },
        { name: 'provider', description: 'Provider name, for example ollama' },
        { name: 'model', description: 'Exact model ID reported by the provider' },
    ],
    async execute(context, args = []) {
        const { action, provider, model } = getOptions(context, args);
        if (!ACTIONS.has(action)) {
            await replyToCommand(context, 'Use `/model list`, `/model set`, or `/model auto`.');
            return;
        }

        try {
            const user = context.user || context.author;
            const scopeId = getModelScope(context.guildId || context.guild?.id, user.id);
            if (action === 'list') {
                const { models, preference: current } = await getAvailableModels(
                    context.client.db,
                    scopeId,
                );
                if (!models.length) {
                    await replyToCommand(context, 'No AI models are currently available. Check that your providers are running and have models loaded.');
                    return;
                }
                const configured = current ? null : getEnvironmentModelSelection(models);
                const effective = current || configured;
                const lines = models.map(item => {
                    const selected = effective?.provider === item.provider
                        && effective?.model === item.model ? ' **(selected)**' : '';
                    return `• \`${item.provider}\` — \`${item.model}\`${selected}`;
                });
                const mode = current?.provider
                    ? `Selected for this server/user: \`${current.provider}/${current.model}\``
                    : `Default from .env: \`${effective.provider}/${effective.model}\``;
                const messages = createModelListMessages(
                    lines,
                    `${mode}\nSet: \`/model set\` · Auto: \`/model auto\``,
                );
                for (const message of messages) {
                    await replyToCommand(context, message);
                }
                return;
            }

            if (action === 'auto') {
                await setModelToAutomatic(context.client.db, scopeId);
                await replyToCommand(context, 'The per-server/user model override was cleared. ZEUS will now follow ZEUS_PROVIDER and ZEUS_MODEL from .env.');
                return;
            }

            if (!model) {
                await replyToCommand(context, 'To select a model, provide both provider and exact model ID. Example: `/model set provider:ollama model:llama3`.');
                return;
            }
            const result = await setPreferredModel(
                context.client.db,
                scopeId,
                provider,
                model,
            );
            if (result.reason === 'invalid-selection') {
                await replyToCommand(context, 'To select a model, provide both provider and exact model ID. Example: `/model set provider:ollama model:llama3`.');
                return;
            }
            if (!result.selected) {
                await replyToCommand(context, `Model \`${model}\` was not found under \`${provider.toLowerCase()}\`. Run \`/model list\` to see loaded local models.`);
                return;
            }
            await replyToCommand(context, `ZEUS will use \`${result.selected.model}\` from \`${result.selected.provider}\` for new responses in this ${context.guildId || context.guild ? 'server' : 'DM'}.`);
        } catch (error) {
            console.error('[MODEL] Failed to update model selection:', error);
            await replyToCommand(context, `Could not update model selection: ${error.message}`);
        }
    },
};
