const { registerShutdownHandlers: registerSharedShutdownHandlers } = require('../../shared/handlers/lifecycleHandler');

function registerShutdownHandlers(options) {
    return registerSharedShutdownHandlers({
        ...options,
        platform: 'DISCORD',
        stopClient: client => client.destroy(),
    });
}

module.exports = { registerShutdownHandlers };
