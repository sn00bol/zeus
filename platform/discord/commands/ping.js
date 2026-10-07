const { getCommandUser, replyToCommand, sendCommandMessage } = require('../utils/commandInteraction');
module.exports = {
    name: 'ping',
    description: 'Test the bot\'s latency',
    usage: 'Zping',
    async execute(message, args) {
        const startedAt = Date.now();
        const sentMessage = await replyToCommand(message, 'ping...');
        const wsPing = message.client.ws.ping;
        const createdTimestamp = message.createdTimestamp || startedAt;
        const roundTrip = sentMessage.createdTimestamp - (createdTimestamp || startedAt);

        await sentMessage.edit(`**Pong!** Currently WebSocket latency is \`${wsPing}ms\` and Actual Response Time (Round-trip) is \`${roundTrip}ms\``);
    },
};