const { getRetryPrompt } = require('../../shared/utils/sessionCommands');
const { respondToUser } = require('../utils/chatThreads');

module.exports = {
    name: 'retry',
    description: 'Retry the latest unanswered prompt in this Telegram chat',
    usage: '/retry',
    async execute(bot, ctx) {
        const conversationId = String(ctx.chat.id);
        const { message } = await getRetryPrompt('telegram', conversationId);
        if (!message?.content || !message.message_id) {
            await ctx.reply('There is no unanswered prompt to retry in this chat.');
            return;
        }

        await ctx.sendChatAction('typing');
        await respondToUser(bot, ctx, message.content, {
            messageId: message.message_id,
            userId: message.user_id || String(ctx.from.id),
            username: message.username || ctx.from.username || ctx.from.first_name,
        });
    },
};
