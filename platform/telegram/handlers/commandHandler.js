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
    bot.on('message', async (ctx) => {
        const msg = ctx.message;
        if (state.isShuttingDown || !msg || !msg.text) return;

        const text = msg.text;

        if (text.startsWith('/')) {
            const args = text.slice(1).split(/ +/);
            const commandName = args.shift().split('@')[0].toLowerCase();

            const command = bot.commands.get(commandName) || bot.aliases.get(commandName);
            if (command) {
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
                return;
            }
        }

        try {
            const homeChat = await bot.db.getTelegramHomeChat();
            if (homeChat && String(msg.chat.id) !== homeChat) return;
        } catch (error) {
            console.error('[HOME] Failed to read configured Telegram home chat:', error);
            return;
        }

        // Cơ chế trò chuyện: Nếu không phải lệnh, gửi prompt tới AI
        const prompt = text;
        const chatPromise = respondToUser(bot, ctx, prompt);
        activeCommands.add(chatPromise);
        chatPromise.finally(() => activeCommands.delete(chatPromise));
    });
}

module.exports = { registerCommandHandlers, loadCommands };
