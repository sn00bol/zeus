const PLATFORM_MESSAGE_MAX_LENGTH = 1_900;

function splitText(text, maxLength) {
    if (text.length <= maxLength) return text.length;
    let end = maxLength;
    if (end > 0 && /[\uD800-\uDBFF]/.test(text[end - 1])) end -= 1;

    const minimumBreak = Math.floor(end * 0.6);
    const newline = text.lastIndexOf('\n', end - 1);
    const whitespace = Math.max(newline, text.lastIndexOf(' ', end - 1));
    if (whitespace >= minimumBreak) end = whitespace + 1;
    return Math.max(1, end);
}

function splitMessage(text, maxLength = PLATFORM_MESSAGE_MAX_LENGTH) {
    if (!Number.isInteger(maxLength) || maxLength < 1) {
        throw new RangeError('Message limit must be a positive integer.');
    }

    const source = String(text);
    const chunks = [];
    let offset = 0;
    while (offset < source.length) {
        const length = splitText(source.slice(offset), maxLength);
        chunks.push(source.slice(offset, offset + length));
        offset += length;
    }
    return chunks.length ? chunks : [''];
}

module.exports = {
    PLATFORM_MESSAGE_MAX_LENGTH,
    splitMessage,
    splitText,
};
