const test = require('node:test');
const assert = require('node:assert/strict');
const {
    formatAgentResponse,
    splitMessage,
} = require('../platform/discord/Adapter').chatThreads;
const { formatText, splitFormattedText } = require('../platform/telegram/richMarkdown');

function assertBalancedHtml(html) {
    const stack = [];
    for (const token of html.match(/<[^>]+>/g) || []) {
        const closing = token.match(/^<\/([a-z][\w-]*)\s*>$/i);
        const opening = token.match(/^<([a-z][\w-]*)/i);
        if (closing) {
            assert.equal(stack.pop(), closing[1].toLowerCase());
        } else if (opening && !token.endsWith('/>')) {
            stack.push(opening[1].toLowerCase());
        }
    }
    assert.deepEqual(stack, []);
}

test('Discord response chunks stay below the platform limit without dropping text', () => {
    const content = '🧠 preserve every sentence in this long answer. '.repeat(100);
    const response = formatAgentResponse({ content, thinking: '' });
    const chunks = splitMessage(response);

    assert.ok(chunks.length > 1);
    assert.ok(chunks.every(chunk => chunk.length <= 1_900));
    assert.equal(chunks.join(''), content);
});

test('Telegram response chunks stay near 1900 characters and keep HTML balanced', () => {
    const content = '🧠 preserve every sentence in this long answer. '.repeat(100);
    const formatted = formatText(content);
    const chunks = splitFormattedText(formatted);

    assert.ok(chunks.length > 1);
    assert.ok(chunks.every(chunk => chunk.length <= 1_900));
    chunks.forEach(assertBalancedHtml);
    assert.equal(
        chunks.join('').replace(/<\/?[^>]+>/g, ''),
        formatted.replace(/<\/?[^>]+>/g, ''),
    );
});
