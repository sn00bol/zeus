const { respondToUser } = require('../Adapter').chatThreads;

module.exports = {
    name: 'agent',
    description: 'Run a prompt with the background AI agent',
    usage: '/agent <prompt>',
    async execute(bot, ctx, args = []) {
        const prompt = args.join(' ').trim();
        if (!prompt) {
            await ctx.reply('Please provide a prompt for the agent.');
            return;
        }
        await respondToUser(bot, ctx, prompt);
    },
};
