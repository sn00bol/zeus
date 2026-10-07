const { requestJson } = require('../utils/agentBridge');
const { respondInChatThread } = require('../utils/chatThreads');

module.exports = {
    name: 'retry',
    description: 'Retry the latest unanswered prompt in this ZEUS thread',
    usage: 'Zretry',
    DMs: false,
    prefixOnly: true,
    async execute(message) {
        if (!message.channel.isThread?.()) {
            await message.reply('Run `retry` inside a ZEUS chat thread.');
            return;
        }
        const chatThread = await message.client.db.getChatThread(message.channelId);
        if (!chatThread) {
            await message.reply('This thread is not a ZEUS chat thread.');
            return;
        }

        const { message: failedMessage } = await requestJson(
            `/sessions/retry?platform=discord&conversation_id=${encodeURIComponent(message.channelId)}`,
        );
        if (!failedMessage?.content || !failedMessage.message_id) {
            await message.reply('There is no unanswered prompt to retry in this thread.');
            return;
        }
        await message.channel.sendTyping();
        await respondInChatThread(
            message.client,
            message,
            chatThread,
            failedMessage.content,
            message.channel,
            {
                messageId: failedMessage.message_id,
                user: {
                    id: failedMessage.user_id || chatThread.owner_id,
                    username: failedMessage.username || message.author.username,
                },
            }
        );
    },
};
