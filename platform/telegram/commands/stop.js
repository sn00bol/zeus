const { requestJson } = require('../Adapter').bridge;

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
            body: { action: 'stop', platform: 'telegram' },
        });
        await ctx.reply('Safe shutdown requested. The Telegram bot and AI bridge will stop.');
        setTimeout(() => process.kill(process.pid, 'SIGTERM'), 750).unref();
    },
};
