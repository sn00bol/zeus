const path = require('node:path');
const { ChannelType, Collection } = require('discord.js');
const { isOwner } = require('../utils/permission');
const { loadCommands: loadPlatformCommands } = require('../../shared/handlers/commandLoader');
const {
    createChatThread,
    getPromptWithoutBotMention,
    respondInChatThread,
} = require('../utils/chatThreads');

async function startMentionChat(client, message, prompt) {
    if (!prompt) {
        await message.reply({
            content: 'Include a question or message after mentioning ZEUS to start a chat thread.',
            allowedMentions: { repliedUser: false },
        });
        return;
    }

    try {
        const thread = await createChatThread(client, message, { prompt });
        await respondInChatThread(client, message, {
            guild_id: message.guildId,
        }, prompt, thread);
    } catch (error) {
        await message.reply({
            content: `Could not create a chat thread. Check that the bot can create public threads: ${error.message}`,
            allowedMentions: { repliedUser: false },
        }).catch(replyError => {
            console.error('[CHAT] Failed to report thread creation error:', replyError);
        });
        return;
    }
}

function loadCommands(client) {
    client.blockedCommands = new Set();
    return loadPlatformCommands(client, {
        directory: path.join(__dirname, '..', 'commands'),
        collectionFactory: () => new Collection(),
        platform: 'DISCORD',
    });
}

async function runCommand(client, command, context, args) {
    const user = context.user || context.author;
    if (context.isChatInputCommand?.() && command.deferReply && !context.deferred && !context.replied) {
        try {
            await context.deferReply();
        } catch (error) {
            console.error(`[DISCORD] Failed to defer '${command.name}' interaction:`, error);
            return;
        }
    }

    try {
        await client.db.ensureDefaultUserSettings(user.id);
    } catch (error) {
        console.error('[SETTINGS] Failed to apply user settings:', error);
    }

    client.db.recordUserActivity(user.id).catch(error => {
        console.error('[ACTIVITY] Failed to record command usage:', error);
    });


    if (client.blockedCommands.has(command.name)) {
        const blockedMessage = 'This command currently blocked due to a bugs or crashing, will fix it fast as possible';
        if (context.isChatInputCommand?.()) {
            return context.reply({ content: blockedMessage, ephemeral: true });
        }
        return context.reply(blockedMessage);
    }

    try {
        if (context.isChatInputCommand?.()) {
            await command.execute(context);
        } else {
            await command.execute(context, args);
        }
    } catch (error) {
        console.error(`[ERROR] Command '${command.name}' failed and is now blocked:`, error);
        client.blockedCommands.add(command.name);
        const errorMessage = 'This command currently blocked due to a bugs or crashing, will fix it fast as possible';
        if (context.isChatInputCommand?.()) {
            if (context.deferred) {
                await context.editReply({ content: errorMessage, embeds: [], components: [] });
            } else if (context.replied) {
                await context.followUp({ content: errorMessage, ephemeral: true });
            } else {
                await context.reply({ content: errorMessage, ephemeral: true });
            }
        } else {
            await context.reply(errorMessage);
        }
    }
}

function trackCommand(client, activeCommands, command, context, args) {
    const commandPromise = runCommand(client, command, context, args);
    activeCommands.add(commandPromise);
    return commandPromise.finally(() => activeCommands.delete(commandPromise));
}

function registerCommandHandlers(client, state, activeCommands) {
    loadCommands(client);
    const prefix = process.env.PFX;

    client.on('messageCreate', async message => {
        if (state.isShuttingDown || message.author.bot) return;

        const botId = client.user?.id;
        if (message.guild && botId && message.mentions.has(botId) && !message.channel.isThread?.()) {
            let homeChannel;
            try {
                homeChannel = await client.db.getHomeChannel(message.guildId);
            } catch (error) {
                console.error('[HOME] Failed to read configured home channel:', error);
                return;
            }
            if (homeChannel && message.channelId !== homeChannel) return;
            const prompt = getPromptWithoutBotMention(message, botId);
            if (typeof message.startThread !== 'function') {
                await message.reply({
                    content: 'Mention ZEUS in a server text channel to start a chat thread.',
                    allowedMentions: { repliedUser: false },
                });
                return;
            }
            await startMentionChat(client, message, prompt);
            return;
        }

        const isCommand = message.content.startsWith(prefix);
        if (!isCommand) {
            let chatThread = null;
            try {
                if (message.channel.isThread?.()) {
                    if ([ChannelType.PublicThread, ChannelType.AnnouncementThread].includes(message.channel.type)) {
                        chatThread = await client.db.getChatThread(message.channelId);
                    }
                }
                if (!chatThread) {
                    await client.db.appendMessage({
                        platform: 'discord',
                        conversation_id: message.channelId,
                        message_id: message.id,
                        role: 'user',
                        content: message.content,
                        user_id: message.author.id,
                        username: message.author.username,
                        channel_id: message.channelId,
                        guild_id: message.guildId,
                        timestamp: message.createdAt.toISOString(),
                    });
                }
            } catch (error) {
                console.error('[HISTORY] Failed to store Discord message:', error);
                return;
            }

            if (chatThread) {
                const prompt = botId && message.mentions.has(botId)
                    ? getPromptWithoutBotMention(message, botId)
                    : message.content;
                await respondInChatThread(client, message, chatThread, prompt || message.content);
            }
            return;
        }

        const args = message.content.slice(prefix.length).trim().split(/ +/);
        const commandName = args.shift().toLowerCase();
        const command = client.commands.get(commandName) || client.aliases.get(commandName);
        if (command && (message.guild || command.DMs !== false)) {
            if (command.ownerOnly && !isOwner(message.author.id)) {
                await message.reply('This command is restricted to the bot owner.');
                return;
            }
            await trackCommand(client, activeCommands, command, message, args);
        }
    });

    client.on('interactionCreate', async interaction => {
        if (state.isShuttingDown || !interaction.isChatInputCommand() || interaction.user.bot) return;

        const command = client.commands.get(interaction.commandName);
        if (!command) {
            return interaction.reply({ content: 'This slash command is no longer available.', ephemeral: true });
        }
        if (!interaction.guild && command.DMs === false) {
            return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
        }
        await trackCommand(client, activeCommands, command, interaction);
    });
}

module.exports = { loadCommands, registerCommandHandlers };
