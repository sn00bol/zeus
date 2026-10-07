const { replyToCommand } = require('../utils/commandInteraction');
const {
    generateConversationReply,
    storeAssistantReply,
} = require('../utils/agentConversation');
const MAX_REPLY_LENGTH = 1_900;

function getPrompt(context, args) {
    if (context.isChatInputCommand?.()) {
        return context.options.getString('prompt', true).trim();
    }
    return args.join(' ').trim();
}

module.exports = {
    name: 'agent',
    description: 'Run a prompt with the background AI agent',
    usage: 'Zagent <prompt>',
    deferReply: true,
    slashOptions: [{
        name: 'prompt',
        description: 'What should the agent work on?',
        required: true,
    }],
    async execute(context, args = []) {
        const prompt = getPrompt(context, args);
        if (!prompt) {
            await replyToCommand(context, 'Please provide a prompt for the agent.');
            return;
        }

        try {
            const conversationId = context.channelId || context.channel.id;
            const user = context.user || context.author;
            const result = await generateConversationReply({
                client: context.client,
                conversationId,
                guildId: context.guildId || context.guild?.id,
                userId: user.id,
                username: user.username,
                messageId: context.id,
                prompt,
            });
            const response = result.content.length > MAX_REPLY_LENGTH
                ? `${result.content.slice(0, MAX_REPLY_LENGTH - 3)}...`
                : result.content;
            const sentMessage = await replyToCommand(context, response);
            try {
                await storeAssistantReply(context.client, {
                    conversationId,
                    guildId: context.guildId || context.guild?.id,
                    messageId: sentMessage?.id || `agent-${context.id}-assistant`,
                    content: response,
                    promptTokens: result.promptTokens,
                    completionTokens: result.completionTokens,
                });
            } catch (error) {
                console.error('[HISTORY] Failed to store agent response:', error);
            }
        } catch (error) {
            console.error('[AGENT] Agent run failed:', error);
            await replyToCommand(context, `Agent run failed: ${error.message}`);
        }
    },
};
