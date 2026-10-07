const { requestJson } = require('../utils/agentBridge');

module.exports = {
    name: 'reset',
    description: 'Clear the current ZEUS thread history and token usage',
    usage: 'Zreset',
    DMs: false,
    prefixOnly: true,
    async execute(message) {
        if (!message.channel.isThread?.()) {
            await message.reply('Run `reset` inside a ZEUS chat thread.');
            return;
        }
        const chatThread = await message.client.db.getChatThread(message.channelId);
        if (!chatThread) {
            await message.reply('This thread is not a ZEUS chat thread.');
            return;
        }
        const result = await requestJson('/sessions/reset', {
            method: 'POST',
            body: { platform: 'discord', conversation_id: message.channelId },
        });
        await message.reply(result.reset
            ? 'This thread’s conversation and usage have been reset. Long-term memory is unchanged.'
            : 'No session was found for this thread.');
    },
};
