const { ChannelType, PermissionFlagsBits } = require('discord.js');

module.exports = {
    name: 'home',
    description: 'Set or clear the server channel where ZEUS accepts new mentions',
    usage: 'Zhome [clear]',
    DMs: false,
    prefixOnly: true,
    async execute(message, args = []) {
        if (!message.guild) {
            await message.reply('This command can only be used in a server.');
            return;
        }
        if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            await message.reply('You need the Manage Server permission to change ZEUS home.');
            return;
        }

        const action = (args[0] || 'set').toLowerCase();
        if (action === 'clear') {
            await message.client.db.setHomeChannel(message.guildId, null);
            await message.reply('ZEUS home channel cleared. Mentions are accepted in any server text channel.');
            return;
        }
        if (action !== 'set') {
            await message.reply('Use `home` to set this channel, or `home clear` to remove the restriction.');
            return;
        }
        if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(message.channel.type)) {
            await message.reply('Set ZEUS home from a regular server text or announcement channel.');
            return;
        }

        await message.client.db.setHomeChannel(message.guildId, message.channelId);
        await message.reply(`ZEUS home set to <#${message.channelId}>. New mentions in other channels will be ignored.`);
    },
};
