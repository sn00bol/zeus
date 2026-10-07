const { Client, IntentsBitField, Partials } = require('discord.js');

function createDiscordClient() {
    const client = new Client({
        intents: [
            IntentsBitField.Flags.Guilds,
            IntentsBitField.Flags.GuildMembers,
            IntentsBitField.Flags.GuildMessages,
            IntentsBitField.Flags.DirectMessages,
            IntentsBitField.Flags.MessageContent,
        ],
        partials: [Partials.Channel],
        rest: {
            timeout: 30_000,
            retries: 5,
        },
    });

    return client;
}

module.exports = { createDiscordClient };
