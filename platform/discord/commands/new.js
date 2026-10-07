const { createChatThread, respondInChatThread } = require('../utils/chatThreads');

module.exports = {
    name: 'new',
    description: 'Create a new ZEUS chat thread from this message',
    usage: 'Znew [first prompt]',
    DMs: false,
    prefixOnly: true,
    async execute(message, args = []) {
        if (!message.guild || message.channel.isThread?.()
            || typeof message.startThread !== 'function') {
            await message.reply('Run `new` in a regular server text channel.');
            return;
        }

        const prompt = args.join(' ').trim();
        let thread;
        try {
            thread = await createChatThread(message.client, message, {
                prompt,
                name: prompt ? '' : `zeus-${message.author.username}`,
            });
        } catch (error) {
            await message.reply(`Could not create a chat thread: ${error.message}`);
            return;
        }

        if (!prompt) {
            await thread.send('New ZEUS chat. Send a message here to begin.');
            return;
        }
        await thread.sendTyping();
        await respondInChatThread(
            message.client,
            message,
            { guild_id: message.guildId },
            prompt,
            thread,
        );
    },
};
