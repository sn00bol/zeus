const {
    generateConversationReply,
    storeAssistantReply,
} = require('./agent/agentConversation');
const { formatText } = require('../utils/formatter');

const MAX_REPLY_LENGTH = 4096;

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

        let response = result.content;
        
        // Format the AI response for Telegram (Convert Discord Markdown to HTML)
        response = formatText(response);

        if (response.length > MAX_REPLY_LENGTH) {
            response = response.slice(0, MAX_REPLY_LENGTH - 3) + '...';
        }

        const sentMessage = await ctx.reply(response, { parse_mode: 'HTML' });

        try {
            await storeAssistantReply(client, {
                conversationId: message.chat.id.toString(),
                messageId: sentMessage.message_id.toString(),
                content: response,
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
    respondToUser,
};
