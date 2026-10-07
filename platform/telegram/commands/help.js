const { sendFormattedMessage } = require('../utils/formatter');

module.exports = {
    name: 'help',
    aliases: ['h'],
    description: 'Display help commands and bot information',
    usage: '/help',
    async execute(bot, ctx) {
        const lines = [...bot.commands.values()]
            .map(command => `• /${command.name} — ${command.description || 'No description'}`);
        await sendFormattedMessage(ctx, `**Available commands**\n${lines.join('\n')}`);
    },
};
