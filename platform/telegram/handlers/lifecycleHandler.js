const { registerShutdownHandlers: registerSharedShutdownHandlers } = require('../../shared/handlers/lifecycleHandler');

function registerShutdownHandlers(options) {
    return registerSharedShutdownHandlers({
        ...options,
        platform: 'TELEGRAM',
        stopClient: bot => {
            if (bot.polling || bot.webhookServer) bot.stop();
        },
    });
}

module.exports = { registerShutdownHandlers };
