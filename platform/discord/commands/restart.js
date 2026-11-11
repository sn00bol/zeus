const { requestJson } = require('../Adapter').bridge;

module.exports = {
    name: 'restart',
    description: 'Safely restart the supervised Discord bot process',
    usage: 'Zrestart',
    category: 'owner',
    ownerOnly: true,
    DMs: false,
    async execute(message) {
        if (process.env.ZEUS_SUPERVISED !== '1') {
            await message.reply('Start ZEUS with `python app.py` to use supervised restart.');
            return;
        }
        await requestJson('/control', {
            method: 'POST',
            body: { action: 'restart', platform: 'discord' },
        });
        await message.reply('Restart requested. Begin restarting... Done!');
        setTimeout(() => process.kill(process.pid, 'SIGTERM'), 750).unref();
    },
};
