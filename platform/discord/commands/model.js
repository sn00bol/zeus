const {
    getAvailableModels,
    setModelToAutomatic,
    setPreferredModel,
} = require('../../shared/utils/modelService');
const { getModelScope } = require('../utils/agentConversation');
const { replyToCommand } = require('../utils/commandInteraction');

const ACTIONS = new Set(['list', 'set', 'auto']);

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
    description: 'List or select the AI provider and locally loaded model',
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
                    await replyToCommand(context, 'No local AI models are available. Start a provider and load a model.');
                    return;
                }
                const lines = models.map(item => {
                    const selected = current?.provider === item.provider
                        && current?.model === item.model ? ' **(selected)**' : '';
                    return `• \`${item.provider}\` — \`${item.model}\`${selected}`;
                });
                const visibleLines = [];
                let outputLength = 0;
                for (const line of lines) {
                    if (outputLength + line.length > 1_650) break;
                    visibleLines.push(line);
                    outputLength += line.length + 1;
                }
                if (lines.length > visibleLines.length) {
                    visibleLines.push(`…and ${lines.length - visibleLines.length} more.`);
                }
                const mode = current?.provider
                    ? `Selected: \`${current.provider}/${current.model}\``
                    : 'Selection: automatic';
                await replyToCommand(context, `**Available local models**\n${visibleLines.join('\n')}\n\n${mode}\nSet: \`/model set\` · Auto: \`/model auto\``);
                return;
            }

            if (action === 'auto') {
                await setModelToAutomatic(context.client.db, scopeId);
                await replyToCommand(context, 'Automatic model selection enabled. ZEUS will scan local providers and use the first available model for each new chat response.');
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
