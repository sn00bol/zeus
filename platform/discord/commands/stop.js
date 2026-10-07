const { requestJson } = require('../utils/agentBridge');

module.exports = {
    name: 'stop',
    description: 'Safely stop the supervised ZEUS application',
    usage: 'Zstop',
    category: 'owner',
    ownerOnly: true,
    DMs: false,
    async execute(message) {
        if (process.env.ZEUS_SUPERVISED !== '1') {
            await message.reply('Start ZEUS with `python app.py` to use supervised shutdown.');
            return;
        }
        await requestJson('/control', {
            method: 'POST',
            body: { action: 'stop' },
        });
        await message.reply('Safe shutdown requested. The bot will stop shortly, have a good day!');
        setTimeout(() => process.kill(process.pid, 'SIGTERM'), 750).unref();
    },
};
