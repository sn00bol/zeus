const { requestJson } = require('../utils/agent/agentBridge');

module.exports = {
    name: 'restart',
    description: 'Safely restart the supervised ZEUS application',
    usage: '/restart',
    async execute(bot, ctx) {
        if (process.env.ZEUS_SUPERVISED !== '1') {
            await ctx.reply('Start ZEUS with `python app.py` to use supervised restart.');
            return;
        }
        await requestJson('/control', {
            method: 'POST',
            body: { action: 'restart' },
        });
        await ctx.reply('Restart requested. ZEUS will reconnect shortly.');
        setTimeout(() => process.kill(process.pid, 'SIGTERM'), 750).unref();
    },
};
