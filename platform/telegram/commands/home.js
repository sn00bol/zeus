module.exports = {
    name: 'home',
    description: 'Set or clear the Telegram group where ZEUS accepts new messages',
    usage: '/home [clear]',
    async execute(bot, ctx, args = []) {
        const chat = ctx.chat;
        if (!chat || !['group', 'supergroup'].includes(chat.type)) {
            await ctx.reply('Run /home in a Telegram group to set it as ZEUS home.');
            return;
        }

        const action = (args[0] || 'set').toLowerCase();
        if (action !== 'set' && action !== 'clear') {
            await ctx.reply('Use /home to set this group, or /home clear to remove the restriction.');
            return;
        }

        const member = await ctx.getChatMember(ctx.from.id);
        if (!['creator', 'administrator'].includes(member.status)) {
            await ctx.reply('You need to be a group administrator to change ZEUS home.');
            return;
        }

        if (action === 'clear') {
            await bot.db.setTelegramHomeChat(null);
            await ctx.reply('ZEUS home chat cleared. Messages are accepted in any Telegram chat.');
            return;
        }

        await bot.db.setTelegramHomeChat(chat.id);
        await ctx.reply('ZEUS home set to this group. Messages in other chats will be ignored.');
    },
};
