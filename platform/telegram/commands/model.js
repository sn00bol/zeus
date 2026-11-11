const { getModelScope } = require('../Adapter').conversation;
const { formatText, sendFormattedMessage } = require('../Adapter').formatter;
const {
    getEnvironmentModelSelection,
    getAvailableModels,
    setModelToAutomatic,
    setPreferredModel,
} = require('../Adapter').modelService;

const ACTIONS = new Set(['list', 'set', 'auto']);
const MODEL_LIST_MESSAGE_LIMIT = 3_800;

function createModelListMessages(lines, footer) {
    const messages = [];
    const heading = '**Available models**';
    const continuedHeading = '**Available models (continued)**';
    let current = heading;
    for (const line of lines) {
        const next = `${current}\n${line}`;
        if (formatText(next).length > MODEL_LIST_MESSAGE_LIMIT) {
            if (current === heading || current === continuedHeading) {
                throw new Error('A model entry is too long to display.');
            }
            messages.push(current);
            current = continuedHeading;
        }
        current += `\n${line}`;
    }

    const finalMessage = `${current}\n\n${footer}`;
    if (formatText(finalMessage).length <= MODEL_LIST_MESSAGE_LIMIT) {
        messages.push(finalMessage);
    } else {
        messages.push(current);
        messages.push(`**Model selection**\n\n${footer}`);
    }
    return messages;
}

module.exports = {
    name: 'model',
    description: 'List or select an available AI provider and model',
    usage: '/model [list|set <provider> <model>|auto]',
    async execute(bot, ctx, args = []) {
        const action = (args[0] || 'list').toLowerCase();
        const userId = String(ctx.from.id);
        const scopeId = getModelScope('telegram', null, userId);

        if (!ACTIONS.has(action)) {
            await ctx.reply('Use /model list, /model set <provider> <model>, or /model auto.');
            return;
        }

        try {
            if (action === 'list') {
                const { models, preference: current } = await getAvailableModels(bot.db, scopeId);
                if (!Array.isArray(models) || models.length === 0) {
                    await ctx.reply('No AI models are currently available. Check that your providers are running and have models loaded.');
                    return;
                }

                const configured = current ? null : getEnvironmentModelSelection(models);
                const effective = current || configured;
                const lines = models.map(item => {
                    const selected = effective?.provider === item.provider
                        && effective?.model === item.model ? ' (selected)' : '';
                    return `• \`${item.provider}\` — \`${item.model}\`${selected}`;
                });
                const mode = current?.provider
                    ? `Selected for this user: \`${current.provider}/${current.model}\``
                    : `Default from .env: \`${effective.provider}/${effective.model}\``;
                const messages = createModelListMessages(lines, mode);
                for (const message of messages) {
                    await sendFormattedMessage(ctx, message);
                }
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
