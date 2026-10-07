const path = require('node:path');
const { respondToUser } = require('../utils/chatThreads');
const { loadCommands: loadPlatformCommands } = require('../../shared/handlers/commandLoader');

function loadCommands(bot) {
    return loadPlatformCommands(bot, {
        directory: path.join(__dirname, '..', 'commands'),
        platform: 'TELEGRAM',
        logLoaded: false,
    });
}

function registerCommandHandlers(bot, state, activeCommands) {
    const executeCommand = (command, ctx, commandText) => {
        const args = commandText.trim().split(/\s+/).slice(1);
        const commandPromise = Promise.resolve()
            .then(() => command.execute(bot, ctx, args, state, activeCommands))
            .catch(async error => {
                console.error(`[COMMAND] Command '${command.name}' failed:`, error);
                await ctx.reply(`Command failed: ${error.message}`).catch(replyError => {
                    console.error('[COMMAND] Failed to report command error:', replyError);
                });
            });
        activeCommands.add(commandPromise);
        commandPromise.finally(() => activeCommands.delete(commandPromise));
    };

    const registeredCommands = new Map(bot.commands);
    for (const [alias, command] of bot.aliases) {
        if (!registeredCommands.has(alias)) registeredCommands.set(alias, command);
    }
    for (const [name, command] of registeredCommands) {
        bot.command(name, ctx => {
            if (state.isShuttingDown || !ctx.message?.text) return;
            executeCommand(command, ctx, ctx.message.text);
        });
    }

    bot.on('text', async (ctx) => {
        const msg = ctx.message;
        if (state.isShuttingDown || !msg || !msg.text) return;
        if (msg.text.startsWith('/')) return;

        try {
            const homeChat = await bot.db.getTelegramHomeChat();
            if (homeChat && String(msg.chat.id) !== homeChat) return;
        } catch (error) {
            console.error('[HOME] Failed to read configured Telegram home chat:', error);
            return;
        }
        // Cơ chế trò chuyện: Nếu không phải lệnh, gửi prompt tới AI
        const chatPromise = respondToUser(bot, ctx, msg.text);
        activeCommands.add(chatPromise);
        chatPromise.finally(() => activeCommands.delete(chatPromise));
    });
}

module.exports = { registerCommandHandlers, loadCommands };
