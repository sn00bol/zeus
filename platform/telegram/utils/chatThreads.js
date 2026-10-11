const {
    generateConversationReply,
    storeAssistantReply,
} = require('./agent/agentConversation');
const { formatText } = require('../utils/formatter');

const MAX_REPLY_LENGTH = 4096;

function formatAgentResponse(result) {
    let content = formatText(result.content);
    if (content.length > MAX_REPLY_LENGTH) {
        content = content.slice(0, MAX_REPLY_LENGTH - 3) + '...';
    }

    const thinking = String(result.thinking || '').trim();
    if (!thinking || content.length >= MAX_REPLY_LENGTH - 40) return content;

    const prefix = '<blockquote expandable>💭 ';
    const suffix = '</blockquote>\n\n';
    const budget = MAX_REPLY_LENGTH - content.length - prefix.length - suffix.length;
    let excerpt = thinking.slice(0, Math.max(0, budget - 16));
    while (excerpt && formatText(excerpt).length > budget) {
        excerpt = excerpt.slice(0, -1);
    }
    if (!excerpt) return content;
    return `${prefix}${formatText(excerpt)}${suffix}${content}`;
}

async function respondToUser(
    client,
    ctx,
    prompt,
    { messageId, userId, username } = {},
) {
    try {
        const { message } = ctx;
        const result = await generateConversationReply({
            client,
            conversationId: message.chat.id.toString(),
            userId: userId || message.from.id.toString(),
            username: username || message.from.username || message.from.first_name,
            messageId: messageId || message.message_id.toString(),
            prompt,
        });

        const response = formatAgentResponse(result);

        const sentMessage = await ctx.reply(response, { parse_mode: 'HTML' });

        try {
            await storeAssistantReply(client, {
                conversationId: message.chat.id.toString(),
                messageId: sentMessage.message_id.toString(),
                content: result.content,
                promptTokens: result.promptTokens,
                completionTokens: result.completionTokens,
            });
        } catch (error) {
            console.error('[HISTORY] Failed to store Telegram agent response:', error);
        }
        return { success: true, response, usage: result };
    } catch (error) {
        console.error('[CHAT] Failed to respond in Telegram:', error);
        await ctx.reply(`ZEUS could not answer: ${error.message}`).catch(sendError => {
            console.error('[CHAT] Failed to report agent error:', sendError);
        });
        return { success: false, error };
    }
}

module.exports = {
    formatAgentResponse,
    respondToUser,
};
