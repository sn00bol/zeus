const { resetConversation } = require('../CommandHandler').sessionCommands;
const { respondToUser } = require('../Adapter').chatThreads;

module.exports = {
    name: 'new',
    description: 'Start a new ZEUS conversation in this Telegram chat',
    usage: '/new [first prompt]',
    async execute(bot, ctx, args = []) {
        const conversationId = String(ctx.chat.id);
        await resetConversation('telegram', conversationId);

        const prompt = args.join(' ').trim();
        if (!prompt) {
            await ctx.reply('Started a new ZEUS conversation. Send a message here to begin.');
            return;
        }
        await respondToUser(bot, ctx, prompt);
    },
};
