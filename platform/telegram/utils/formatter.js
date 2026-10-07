/**
 * Formatting utilities for Telegram
 */

function formatText(text) {
    if (!text) return '';
    
    // IMPORTANT: Escape HTML special characters first to prevent "can't parse entities" errors
    let formatted = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    // Convert Discord-style Markdown to Telegram-style HTML
    // 1. Bold: **text** -> <b>text</b>
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
    
    // 2. Inline code: `text` -> <code>text</code>
    formatted = formatted.replace(/`(.*?)`/g, '<code>$1</code>');
    
    // 3. Block code: ```lang\ntext\n``` -> <pre>text</pre>
    formatted = formatted.replace(/```(\w*)\n?([\s\S]*?)\n?```/g, '<pre>$2</pre>');
    
    // 4. Italic: *text* or _text_ -> <i>text</i>
    formatted = formatted.replace(/\*(.*?)\*/g, '<i>$1</i>');
    formatted = formatted.replace(/_(.*?)_/g, '<i>$1</i>');
    
    return formatted;
}

async function sendFormattedMessage(ctx, text, isAlreadyFormatted = false) {
    const formattedText = isAlreadyFormatted ? text : formatText(text);
    return await ctx.reply(formattedText, { parse_mode: 'HTML' });
}

module.exports = {
    formatText,
    sendFormattedMessage,
};
