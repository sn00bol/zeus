const repliedInteractions = new WeakSet();

function interactionPayload(payload) {
    if (typeof payload === 'string') return { content: payload, fetchReply: true };
    return { ...payload, fetchReply: true };
}

function getCommandUser(context) {
    return context.user || context.author;
}

async function replyToCommand(context, payload) {
    if (!context.isChatInputCommand?.()) return context.reply(payload);

    if (context.deferred && !repliedInteractions.has(context)) {
        repliedInteractions.add(context);
        return context.editReply(payload);
    }
    repliedInteractions.add(context);
    if (context.replied || context.deferred) return context.followUp(interactionPayload(payload));
    return context.reply(interactionPayload(payload));
}

async function sendCommandMessage(context, payload) {
    if (!context.isChatInputCommand?.()) {
        return context.channel.send(payload);
    }

    if (context.deferred && !repliedInteractions.has(context)) {
        repliedInteractions.add(context);
        await context.editReply(payload);
        return context.fetchReply();
    }
    if (context.replied || context.deferred) return context.channel.send(payload);

    repliedInteractions.add(context);
    await context.reply(interactionPayload(payload));
    return context.fetchReply();
}

module.exports = { getCommandUser, replyToCommand, sendCommandMessage };
