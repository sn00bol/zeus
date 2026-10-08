const { getModelScope } = require('../utils/agent/agentConversation');
const { sendFormattedMessage } = require('../utils/formatter');
const {
    getEnvironmentModelSelection,
    getAvailableModels,
    setModelToAutomatic,
    setPreferredModel,
} = require('../../shared/utils/modelService');

const ACTIONS = new Set(['list', 'set', 'auto']);

module.exports = {
    name: 'model',
    description: 'List or select the AI provider and locally loaded model',
    usage: '/model [list|set <provider> <model>|auto]',
    async execute(bot, ctx, args = []) {
        const action = (args[0] || 'list').toLowerCase();
        const userId = String(ctx.from.id);
        const scopeId = getModelScope(userId);

        if (!ACTIONS.has(action)) {
            await ctx.reply('Use /model list, /model set <provider> <model>, or /model auto.');
            return;
        }

        try {
            if (action === 'list') {
                const { models, preference: current } = await getAvailableModels(bot.db, scopeId);
                if (!Array.isArray(models) || models.length === 0) {
                    await ctx.reply('No local AI models are available. Start a provider and load a model.');
                    return;
                }

                const configured = current ? null : getEnvironmentModelSelection(models);
                const effective = current || configured;
                const lines = models.map(item => {
                    const selected = effective?.provider === item.provider
                        && effective?.model === item.model ? ' (selected)' : '';
                    return `• \`${item.provider}\` — \`${item.model}\`${selected}`;
                });
                const visibleLines = [];
                let outputLength = 0;
                for (const line of lines) {
                    if (outputLength + line.length > 1_800) break;
                    visibleLines.push(line);
                    outputLength += line.length + 1;
                }
                if (lines.length > visibleLines.length) {
                    visibleLines.push(`…and ${lines.length - visibleLines.length} more.`);
                }
                const mode = current?.provider
                    ? `Selected for this user: \`${current.provider}/${current.model}\``
                    : `Default from .env: \`${effective.provider}/${effective.model}\``;
                await sendFormattedMessage(
                    ctx,
                    `**Available local models**\n${visibleLines.join('\n')}\n\n${mode}`,
                );
                return;
            }

            if (action === 'auto') {
                await setModelToAutomatic(bot.db, scopeId);
                await ctx.reply('The per-user model override was cleared. ZEUS will now follow ZEUS_PROVIDER and ZEUS_MODEL from .env.');
                return;
            }

            const provider = (args[1] || '').toLowerCase();
            const model = args.slice(2).join(' ').trim();
            if (!model) {
                await ctx.reply('Provide a supported provider and exact model ID. Example: /model set ollama llama3');
                return;
            }

            const result = await setPreferredModel(bot.db, scopeId, provider, model);
            if (!result.selected && result.reason === 'invalid-selection') {
                await ctx.reply('Provide a supported provider and exact model ID. Example: /model set ollama llama3');
                return;
            }
            if (!result.selected) {
                await ctx.reply(`Model ${model} was not found under ${provider}. Run /model list to see loaded local models.`);
                return;
            }

            const { selected } = result;
            await sendFormattedMessage(
                ctx,
                `ZEUS will use \`${selected.model}\` from \`${selected.provider}\` for new responses in this chat.`,
            );
        } catch (error) {
            console.error('[MODEL] Failed to update Telegram model selection:', error);
            await ctx.reply(`Could not update model selection: ${error.message}`);
        }
    },
};
