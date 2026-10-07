const { requestJson } = require('../utils/agent/agentBridge');

module.exports = {
    name: 'stop',
    description: 'Safely stop the supervised ZEUS application',
    usage: '/stop',
    async execute(bot, ctx) {
        if (process.env.ZEUS_SUPERVISED !== '1') {
            await ctx.reply('Start ZEUS with `python app.py` to use supervised shutdown.');
            return;
        }
        await requestJson('/control', {
            method: 'POST',
            body: { action: 'stop' },
        });
        await ctx.reply('Safe shutdown requested. The Telegram bot and AI bridge will stop.');
        setTimeout(() => process.kill(process.pid, 'SIGTERM'), 750).unref();
    },
};
