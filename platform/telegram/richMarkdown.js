const MarkdownIt = require('markdown-it');
const {
    PLATFORM_MESSAGE_MAX_LENGTH,
    splitText,
} = require('../messageChunks');

const markdown = new MarkdownIt({
    breaks: true,
    html: false,
    linkify: true,
    typographer: false,
});
markdown.enable(['table']);

const renderer = markdown.renderer.rules;

renderer.paragraph_open = () => '';
renderer.paragraph_close = (tokens, index, options, env) => (
    env.listStack?.length ? '' : '\n\n'
);
renderer.heading_open = (tokens, index) => {
    switch (tokens[index].tag) {
        case 'h1': return '\n<b>';
        case 'h2': return '\n\n<b>';
        case 'h3': return '\n<i><b>';
        case 'h4': return '\n<u><b>';
        case 'h5': return '\n<i>';
        default: return '\n<u>';
    }
};
renderer.heading_close = (tokens, index) => {
    switch (tokens[index].tag) {
        case 'h1': return '</b>\n━━━━━━━━━━━━━━━━━━━━\n';
        case 'h2': return '</b>\n\n';
        case 'h3': return '</b></i>\n';
        case 'h4': return '</b></u>\n\n';
        case 'h5': return '</i>\n';
        default: return '</u>\n';
    }
};
renderer.blockquote_open = () => '<blockquote>';
renderer.blockquote_close = () => '</blockquote>\n\n';
renderer.bullet_list_open = (tokens, index, options, env) => {
    env.listStack ||= [];
    env.listStack.push({ ordered: false, next: 1 });
    return '\n';
};
renderer.ordered_list_open = (tokens, index, options, env) => {
    env.listStack ||= [];
    const start = Number(tokens[index].attrGet('start')) || 1;
    env.listStack.push({ ordered: true, next: start });
    return '\n';
};
renderer.bullet_list_close = (tokens, index, options, env) => {
    env.listStack.pop();
    return env.listStack.length ? '' : '\n';
};
renderer.ordered_list_close = renderer.bullet_list_close;
renderer.list_item_open = (tokens, index, options, env) => {
    const depth = Math.max(0, env.listStack.length - 1);
    const list = env.listStack[depth];
    const marker = list.ordered ? `${list.next++}.` : '•';
    return `${'  '.repeat(depth)}${marker} `;
};
renderer.list_item_close = () => '\n';
renderer.hr = () => '━━━━━━━━━━━━━━━━━━━━\n\n';
renderer.softbreak = () => '\n';
renderer.hardbreak = () => '\n';
renderer.strong_open = () => '<b>';
renderer.strong_close = () => '</b>';
renderer.em_open = () => '<i>';
renderer.em_close = () => '</i>';
renderer.s_open = () => '<s>';
renderer.s_close = () => '</s>';
renderer.code_inline = (tokens, index) => (
    `<code>${markdown.utils.escapeHtml(tokens[index].content)}</code>`
);
renderer.fence = (tokens, index) => {
    const token = tokens[index];
    const language = token.info.trim().split(/\s+/, 1)[0].replace(/[^\w+-]/g, '');
    const className = language ? ` class="language-${language}"` : '';
    const code = markdown.utils.escapeHtml(token.content.replace(/\n$/, ''));
    return `<pre><code${className}>${code}</code></pre>\n\n`;
};
renderer.code_block = (tokens, index) => {
    const code = markdown.utils.escapeHtml(tokens[index].content.replace(/\n$/, ''));
    return `<pre>${code}</pre>\n\n`;
};
renderer.link_open = (tokens, index) => {
    const href = tokens[index].attrGet('href') || '';
    return `<a href="${escapeAttribute(href)}">`;
};
renderer.link_close = () => '</a>';
renderer.image = (tokens, index) => {
    const token = tokens[index];
    const alt = markdown.utils.escapeHtml(token.content || 'Image');
    const source = token.attrGet('src') || '';
    return source && markdown.validateLink(source)
        ? `<a href="${escapeAttribute(source)}">${alt}</a>`
        : alt;
};
renderer.table_open = (tokens, index, options, env, self) => {
    const headers = [];
    for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
        const token = tokens[cursor];
        if (token.type === 'table_close') break;
        if (token.type === 'inline' && token.children?.length) {
            const previous = tokens[cursor - 1];
            if (previous?.type === 'th_open') {
                headers.push(self.renderInline(token.children, options, env).trim());
                token.children = [];
            }
        }
    }
    env.tableState = {
        headers,
        columnIndex: 0,
        inBody: false,
        inHead: false,
    };
    return '\n';
};
renderer.table_close = (tokens, index, options, env) => {
    delete env.tableState;
    return '\n';
};
renderer.thead_open = (tokens, index, options, env) => {
    if (env.tableState) env.tableState.inHead = true;
    return '';
};
renderer.thead_close = (tokens, index, options, env) => {
    if (env.tableState) env.tableState.inHead = false;
    return '';
};
renderer.tbody_open = (tokens, index, options, env) => {
    if (env.tableState) env.tableState.inBody = true;
    return '';
};
renderer.tbody_close = (tokens, index, options, env) => {
    if (env.tableState) env.tableState.inBody = false;
    return '';
};
renderer.tr_open = (tokens, index, options, env) => {
    if (env.tableState?.inBody) env.tableState.columnIndex = 0;
    return env.tableState?.inBody ? '• ' : '';
};
renderer.tr_close = (tokens, index, options, env) => (
    env.tableState?.inBody ? '\n' : ''
);
renderer.th_open = () => '';
renderer.th_close = () => '';
renderer.td_open = (tokens, index, options, env) => {
    const table = env.tableState;
    if (!table) return '';
    const column = table.columnIndex++;
    const label = table.headers[column] || `Column ${column + 1}`;
    return `${column ? '  ' : ''}<b>${label}:</b> `;
};
renderer.td_close = (tokens, index, options, env) => (
    env.tableState ? '\n' : ''
);

function escapeAttribute(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function formatText(text) {
    if (text === null || text === undefined || text === '') return '';
    const formatted = markdown.render(String(text)).trim();
    return formatted;
}

function closingTags(stack) {
    return stack.slice().reverse().map(tag => `</${tag.name}>`).join('');
}

function splitFormattedText(formatted, maxLength = PLATFORM_MESSAGE_MAX_LENGTH) {
    if (!Number.isInteger(maxLength) || maxLength < 32) {
        throw new RangeError('Telegram message limit must be an integer of at least 32.');
    }

    const chunks = [];
    const stack = [];
    let current = '';
    const tokens = String(formatted).match(/<[^>]+>|[^<]+/g) || [];

    function flush() {
        const chunk = `${current}${closingTags(stack)}`;
        if (chunk) chunks.push(chunk);
        current = stack.map(tag => tag.open).join('');
    }

    for (const token of tokens) {
        const closing = token.match(/^<\/([a-z][\w-]*)\s*>$/i);
        const opening = token.match(/^<([a-z][\w-]*)(?:\s[^>]*)?>$/i);

        if (closing) {
            const name = closing[1].toLowerCase();
            const stackIndex = stack.map(tag => tag.name).lastIndexOf(name);
            const remaining = stackIndex >= 0 ? stack.slice(0, stackIndex) : stack;
            if (current.length + token.length + closingTags(remaining).length > maxLength) {
                flush();
            }
            current += token;
            if (stackIndex >= 0) stack.splice(stackIndex);
            continue;
        }

        if (opening && !token.endsWith('/>')) {
            const tag = { name: opening[1].toLowerCase(), open: token };
            if (current.length + token.length
                + closingTags([...stack, tag]).length > maxLength) {
                flush();
            }
            current += token;
            stack.push(tag);
            continue;
        }

        if (opening) {
            if (current.length + token.length + closingTags(stack).length > maxLength) {
                flush();
            }
            current += token;
            continue;
        }

        let remainingText = token;
        while (remainingText) {
            let available = maxLength - current.length - closingTags(stack).length;
            if (available < 1) {
                flush();
                available = maxLength - current.length - closingTags(stack).length;
            }
            const take = splitText(remainingText, available);
            current += remainingText.slice(0, take);
            remainingText = remainingText.slice(take);
            if (remainingText) flush();
        }
    }

    if (current) chunks.push(current);
    return chunks.length ? chunks : [''];
}

module.exports = {
    formatText,
    splitFormattedText,
};
