module.exports = {
    name: 'ping',
    description: 'Test the bot\'s latency',
    usage: '/ping',
    async execute(bot, ctx) {
        const startedAt = Date.now();
        const sentMessage = await ctx.reply('Pinging...');
        const roundTrip = Date.now() - startedAt;
        await ctx.telegram.editMessageText(
            ctx.chat.id,
            sentMessage.message_id,
            undefined,
            `<b>Pong!</b> Telegram response time is <code>${roundTrip}ms</code>`,
            { parse_mode: 'HTML' },
        );
    },
};
