const { getRetryPrompt } = require('../CommandHandler').sessionCommands;
const { respondInChatThread } = require('../Adapter').chatThreads;
const { replyToCommand } = require('../CommandHandler').commandInteraction;

const CONFIRMATION_DELETE_DELAY_MS = 5_000;

async function acknowledgeRetry(context) {
    if (context.isChatInputCommand?.()) {
        try {
            await replyToCommand(context, 'Retry successful!');
        } catch (error) {
            console.error('[RETRY] Failed to send retry confirmation:', error);
            return;
        }

        const timer = setTimeout(() => {
            context.deleteReply().catch(error => {
                console.error('[RETRY] Failed to delete retry confirmation:', error);
            });
        }, CONFIRMATION_DELETE_DELAY_MS);
        timer.unref?.();
        return;
    }

    try {
        await context.channel.send('Retry successful!');
    } catch (error) {
        console.error('[RETRY] Failed to send retry confirmation:', error);
        return;
    }

    try {
        await context.delete();
    } catch (error) {
        console.error('[RETRY] Failed to delete retry command message:', error);
    }
}

module.exports = {
    name: 'retry',
    description: 'Retry the latest unanswered prompt in this ZEUS thread',
    usage: 'Zretry',
    DMs: false,
    deferReply: { ephemeral: true },
    async execute(context) {
        if (!context.channel.isThread?.()) {
            await replyToCommand(context, 'Run `retry` inside a ZEUS chat thread.');
            return;
        }
        const chatThread = await context.client.db.getChatThread(context.channelId);
        if (!chatThread) {
            await replyToCommand(context, 'This thread is not a ZEUS chat thread.');
            return;
        }

        const { message: failedMessage } = await getRetryPrompt('discord', context.channelId);
        if (!failedMessage?.content || !failedMessage.message_id) {
            await replyToCommand(context, 'There is no unanswered prompt to retry in this thread.');
            return;
        }
        await context.channel.sendTyping();
        await respondInChatThread(
            context.client,
            context,
            chatThread,
            failedMessage.content,
            context.channel,
            {
                messageId: failedMessage.message_id,
                user: {
                    id: failedMessage.user_id || chatThread.owner_id,
                    username: failedMessage.username || (context.user || context.author).username,
                },
                onQueued: () => acknowledgeRetry(context),
            }
        );
    },
};
