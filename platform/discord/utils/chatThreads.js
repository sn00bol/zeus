const { ChannelType } = require('discord.js');
const {
    generateConversationReply,
    storeAssistantReply,
} = require('./agentConversation');

const MAX_REPLY_LENGTH = 1_900;

function getPromptWithoutBotMention(message, botId) {
    return message.content.replace(new RegExp(`<@!?${botId}>`, 'g'), '').trim();
}

async function respondInChatThread(
    client,
    message,
    chatThread,
    prompt,
    channel = message.channel,
    { messageId = message.id, user = message.author } = {},
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
        });
        const response = result.content.length > MAX_REPLY_LENGTH
            ? `${result.content.slice(0, MAX_REPLY_LENGTH - 3)}...`
            : result.content;
        const sentMessage = await channel.send(response);
        try {
            await storeAssistantReply(client, {
                conversationId: channel.id,
                guildId: chatThread.guild_id,
                messageId: sentMessage.id,
                content: response,
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
    getPromptWithoutBotMention,
    respondInChatThread,
};
