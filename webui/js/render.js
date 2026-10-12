import { renderMathToHtml } from './renderMath.js';
import { sanitizeHtml } from './renderHTML.js';

const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

const KEYWORDS = new Set([
    'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
    'debugger', 'default', 'delete', 'do', 'else', 'export', 'extends', 'finally',
    'for', 'from', 'function', 'if', 'import', 'in', 'instanceof', 'let', 'new',
    'return', 'super', 'switch', 'this', 'throw', 'try', 'typeof', 'var', 'void',
    'while', 'with', 'yield', 'def', 'elif', 'except', 'lambda', 'pass', 'raise',
    'is', 'not', 'and', 'or', 'public', 'private', 'protected', 'static', 'interface',
    'implements', 'type', 'enum', 'struct', 'fn', 'mut', 'impl', 'trait', 'pub',
    'select', 'where', 'insert', 'update', 'into', 'values', 'delete', 'join',
    'inner', 'outer', 'left', 'right', 'group', 'by', 'order', 'having', 'limit',
]);

const BUILTINS = new Set([
    'true', 'false', 'null', 'undefined', 'None', 'True', 'False', 'nil',
    'self', 'cls', 'int', 'float', 'str', 'bool', 'list', 'dict', 'set', 'tuple',
    'Array', 'Object', 'String', 'Number', 'Boolean', 'Promise', 'Map', 'Set',
    'console', 'window', 'document', 'process', 'global',
]);

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function normalizeInlineText(text) {
    return text
        .replace(/(^|[\s(])->([\s)]|$)/g, '$1→$2')
        .replace(/(^|[\s(])-->([\s)]|$)/g, '$1→$2')
        .replace(/(^|[\s(])<-([\s)]|$)/g, '$1←$2')
        .replace(/(^|[\s(])<--([\s)]|$)/g, '$1←$2')
        .replace(/(^|[\s(])=>([\s)]|$)/g, '$1⇒$2')
        .replace(/(^|[\s(])==>([\s)]|$)/g, '$1⇒$2')
        .replace(/(^|[\s(])<=>([\s)]|$)/g, '$1⇔$2');
}

function highlightCode(rawCode, language) {
    const lang = (language || '').toLowerCase().trim();
    if (!rawCode || ['txt', 'text', 'plain', 'markdown', 'md'].includes(lang)) {
        return escapeHtml(rawCode);
    }

    return rawCode.split('\n').map(line => {
        let result = '';
        let i = 0;
        while (i < line.length) {
            if (
                (line[i] === '#' && ['python', 'py', 'bash', 'sh', 'yaml', 'yml', 'dockerfile'].includes(lang))
                || (line[i] === '/' && line[i + 1] === '/')
                || (line[i] === '-' && line[i + 1] === '-' && ['sql', 'lua'].includes(lang))
            ) {
                result += `<span class="tok-com">${escapeHtml(line.slice(i))}</span>`;
                break;
            }

            if (['"', "'", '`'].includes(line[i])) {
                const quote = line[i];
                let end = i + 1;
                while (end < line.length && line[end] !== quote) {
                    if (line[end] === '\\') end += 1;
                    end += 1;
                }
                if (end < line.length) end += 1;
                result += `<span class="tok-str">${escapeHtml(line.slice(i, end))}</span>`;
                i = end;
                continue;
            }

            if (/\d/.test(line[i]) && (i === 0 || /[\s,([{:+\-*\/=><]/.test(line[i - 1]))) {
                let end = i;
                if (line[end] === '0' && /[xX]/.test(line[end + 1] || '')) end += 2;
                while (end < line.length && /[\d.a-fA-F_]/.test(line[end])) end += 1;
                result += `<span class="tok-num">${escapeHtml(line.slice(i, end))}</span>`;
                i = end;
                continue;
            }

            if (/[a-zA-Z_$]/.test(line[i])) {
                let end = i + 1;
                while (end < line.length && /[a-zA-Z0-9_$]/.test(line[end])) end += 1;
                const word = line.slice(i, end);
                const tokenClass = KEYWORDS.has(word)
                    ? 'tok-kw'
                    : BUILTINS.has(word)
                        ? 'tok-builtin'
                        : line[end] === '(' ? 'tok-fn' : '';
                result += tokenClass
                    ? `<span class="${tokenClass}">${escapeHtml(word)}</span>`
                    : escapeHtml(word);
                i = end;
                continue;
            }

            if (line[i] === '<' && ['html', 'xml', 'jsx', 'tsx'].includes(lang)) {
                const tag = line.slice(i).match(/^<\/?([a-zA-Z0-9_-]+)/);
                if (tag) {
                    result += `&lt;<span class="tok-tag">${escapeHtml(tag[1])}</span>`;
                    i += tag[0].length;
                    continue;
                }
            }

            result += escapeHtml(line[i]);
            i += 1;
        }
        return result;
    }).join('\n');
}

function isSafeUrl(value) {
    try {
        const url = new URL(value, 'https://zeus.invalid');
        return SAFE_PROTOCOLS.has(url.protocol.toLowerCase());
    } catch {
        return false;
    }
}

function findClosingDelimiter(source, delimiter, start) {
    let index = start;
    while ((index = source.indexOf(delimiter, index)) !== -1) {
        let slashes = 0;
        for (let i = index - 1; i >= 0 && source[i] === '\\'; i -= 1) slashes += 1;
        if (slashes % 2 === 0) return index;
        index += delimiter.length;
    }
    return -1;
}

function normalizeBareSummationLine(line) {
    let result = '';
    let cursor = 0;

    while (cursor < line.length) {
        const codeStart = line.indexOf('`', cursor);
        const textEnd = codeStart < 0 ? line.length : codeStart;
        result += line.slice(cursor, textEnd).replace(
            /([∑∏])\s*[*_]\s*(\{[^{}\n]+\})(?:\^\{[^{}\n]+\})?[^,\n]*/gu,
            candidate => {
                if (!candidate.includes('=')) return candidate;
                let formula = candidate
                    .replace(/^∑\s*[*_]\s*/, '\\sum_')
                    .replace(/^∏\s*[*_]\s*/, '\\prod_')
                    .trimEnd();
                let punctuation = '';
                if (/[.!?]$/.test(formula)) {
                    punctuation = formula.slice(-1);
                    formula = formula.slice(0, -1).trimEnd();
                }
                return `$${formula}$${punctuation}`;
            },
        );
        if (codeStart < 0) break;

        let tickEnd = codeStart + 1;
        while (line[tickEnd] === '`') tickEnd += 1;
        const marker = line.slice(codeStart, tickEnd);
        const codeEnd = line.indexOf(marker, tickEnd);
        if (codeEnd < 0) {
            result += line.slice(codeStart);
            break;
        }
        result += line.slice(codeStart, codeEnd + marker.length);
        cursor = codeEnd + marker.length;
    }
    return result;
}

function normalizeBareSummations(source) {
    let fenceCharacter = '';
    let fenceLength = 0;
    return source.split('\n').map(line => {
        const fence = line.match(/^\s*(`{3,}|~{3,})/);
        if (fence) {
            const marker = fence[1];
            const character = marker[0];
            if (!fenceCharacter) {
                fenceCharacter = character;
                fenceLength = marker.length;
            } else if (character === fenceCharacter && marker.length >= fenceLength) {
                fenceCharacter = '';
                fenceLength = 0;
            }
            return line;
        }
        return fenceCharacter ? line : normalizeBareSummationLine(line);
    }).join('\n');
}

function mathInlineRule(state, silent) {
    const { src, pos, posMax } = state;
    let delimiter;
    let displayMode = false;
    if (src.startsWith('$$', pos)) {
        delimiter = '$$';
        displayMode = true;
    } else if (src.startsWith('$', pos)) {
        delimiter = '$';
    } else if (src.startsWith('\\(', pos)) {
        delimiter = '\\(';
    } else if (src.startsWith('\\[', pos)) {
        delimiter = '\\[';
        displayMode = true;
    } else {
        return false;
    }

    const closingDelimiter = delimiter === '\\(' ? '\\)' : delimiter === '\\[' ? '\\]' : delimiter;
    const closingIndex = findClosingDelimiter(
        src.slice(0, posMax),
        closingDelimiter,
        pos + delimiter.length,
    );
    if (closingIndex < 0 || closingIndex === pos + delimiter.length) return false;
    const content = src.slice(pos + delimiter.length, closingIndex);

    if (!silent) {
        const token = state.push('zeus_math_inline', 'span', 0);
        token.content = content;
        token.meta = { displayMode };
        token.markup = delimiter;
    }
    state.pos = closingIndex + closingDelimiter.length;
    return true;
}

function protectMathPipes(source) {
    return source.split('\n').map(line => {
        if (!line.includes('|')) return line;

        let result = '';
        let cursor = 0;
        let position = 0;
        while (position < line.length) {
            if (line[position] === '`') {
                let fenceEnd = position + 1;
                while (line[fenceEnd] === '`') fenceEnd += 1;
                const fence = line.slice(position, fenceEnd);
                const close = line.indexOf(fence, fenceEnd);
                if (close < 0) break;
                position = close + fence.length;
                continue;
            }

            let delimiter;
            let closingDelimiter;
            if (line.startsWith('$$', position)) {
                delimiter = closingDelimiter = '$$';
            } else if (line.startsWith('\\(', position)) {
                delimiter = '\\(';
                closingDelimiter = '\\)';
            } else if (line.startsWith('\\[', position)) {
                delimiter = '\\[';
                closingDelimiter = '\\]';
            } else if (line[position] === '$') {
                delimiter = closingDelimiter = '$';
            }
            if (!delimiter) {
                position += 1;
                continue;
            }

            let slashes = 0;
            for (let i = position - 1; i >= 0 && line[i] === '\\'; i -= 1) slashes += 1;
            if (slashes % 2) {
                position += delimiter.length;
                continue;
            }

            const close = findClosingDelimiter(line, closingDelimiter, position + delimiter.length);
            if (close < 0) {
                position += delimiter.length;
                continue;
            }

            let inner = line.slice(position + delimiter.length, close);
            inner = inner.replace(/(^|[^\\])\|/g, '$1\\|');
            const end = close + closingDelimiter.length;
            result += line.slice(cursor, position) + delimiter + inner + closingDelimiter;
            cursor = end;
            position = end;
        }

        return cursor ? result + line.slice(cursor) : line;
    }).join('\n');
}

function mathBlockRule(state, startLine, endLine, silent) {
    const opening = state.getLines(startLine, startLine + 1, 0, false).trim();
    const closing = opening === '$$' ? '$$' : opening === '\\[' ? '\\]' : null;
    if (!closing) return false;

    let end = startLine + 1;
    while (end < endLine && state.getLines(end, end + 1, 0, false).trim() !== closing) end += 1;
    if (end >= endLine) return false;
    if (silent) return true;

    const token = state.push('zeus_math_block', 'div', 0);
    token.block = true;
    token.content = state.getLines(startLine + 1, end, 0, false);
    token.map = [startLine, end + 1];
    token.markup = opening;
    state.line = end + 1;
    return true;
}

function markInlineRule(state, silent) {
    const { src, pos } = state;
    if (!src.startsWith('==', pos)) return false;
    const closingIndex = findClosingDelimiter(src, '==', pos + 2);
    if (closingIndex <= pos + 2) return false;

    if (!silent) {
        const token = state.push('zeus_mark', 'mark', 0);
        token.content = src.slice(pos + 2, closingIndex);
        token.children = [];
        state.md.inline.parse(token.content, state.md, state.env, token.children);
    }
    state.pos = closingIndex + 2;
    return true;
}

function createMarkdownRenderer() {
    if (typeof globalThis.markdownit !== 'function') {
        throw new Error('Markdown parser is unavailable. Reload the WebUI to retry.');
    }

    const md = globalThis.markdownit({
        html: true,
        linkify: true,
        breaks: true,
        highlight: highlightCode,
        validateLink: isSafeUrl,
    });

    md.core.ruler.before('block', 'zeus_protect_math_pipes', state => {
        state.src = normalizeBareSummations(state.src);
        state.src = protectMathPipes(state.src);
    });
    md.inline.ruler.before('escape', 'zeus_math_inline', mathInlineRule);
    md.inline.ruler.before('emphasis', 'zeus_mark_inline', markInlineRule);
    md.block.ruler.before('fence', 'zeus_math_block', mathBlockRule, {
        alt: ['paragraph', 'reference', 'blockquote', 'list'],
    });
    md.renderer.rules.zeus_math_inline = (tokens, index) => {
        const token = tokens[index];
        const displayMode = token.meta.displayMode;
        const className = displayMode ? 'math-display' : 'math-inline';
        return `<span class="${className}">${renderMathToHtml(token.content, displayMode)}</span>`;
    };
    md.renderer.rules.zeus_math_block = (tokens, index) => (
        `<div class="math-block-container"><div class="math-block">${renderMathToHtml(tokens[index].content, true)}</div></div>\n`
    );
    md.renderer.rules.zeus_mark = (tokens, index, options, env, self) => (
        `<mark>${self.renderInline(tokens[index].children, options, env)}</mark>`
    );
    md.renderer.rules.fence = (tokens, index) => {
        const token = tokens[index];
        const language = token.info.trim().split(/\s+/, 1)[0];
        const languageAttributes = language
            ? ` class="language-${escapeHtml(language)}" data-language="${escapeHtml(language)}"`
            : '';
        return `<pre><code${languageAttributes}>${highlightCode(token.content, language)}</code></pre>\n`;
    };
    md.renderer.rules.table_open = () => (
        '<div class="table-wrapper" role="region" aria-label="Scrollable table" tabindex="0">'
        + '<table class="markdown-table">\n'
    );
    md.renderer.rules.table_close = () => '</table></div>\n';
    for (const tokenType of ['th_open', 'td_open']) {
        md.renderer.rules[tokenType] = (tokens, index, options, env, self) => {
            const token = tokens[index];
            const styleIndex = token.attrIndex('style');
            const style = styleIndex < 0 ? '' : token.attrs[styleIndex][1];
            const alignment = style.match(/^\s*text-align:\s*(left|center|right)\s*;?\s*$/i);
            if (styleIndex >= 0) token.attrs.splice(styleIndex, 1);
            if (alignment) token.attrSet('align', alignment[1].toLowerCase());
            return self.renderToken(tokens, index, options);
        };
    }
    md.renderer.rules.text = (tokens, index) => (
        escapeHtml(normalizeInlineText(tokens[index].content))
    );
    md.renderer.rules.link_open = (tokens, index, options, env, self) => {
        const token = tokens[index];
        token.attrSet('target', '_blank');
        token.attrSet('rel', 'noopener noreferrer');
        return self.renderToken(tokens, index, options);
    };
    md.renderer.rules.image = (tokens, index, options, env, self) => {
        const token = tokens[index];
        token.attrSet('loading', 'lazy');
        token.attrSet('decoding', 'async');
        return self.renderToken(tokens, index, options);
    };

    if (typeof globalThis.markdownitTaskLists === 'function') {
        md.use(globalThis.markdownitTaskLists, { enabled: false });
    }

    return md;
}

let markdownRenderer;

export function renderMessageContent(container, source) {
    if (source === null || source === undefined) {
        if (container.hasChildNodes()) container.replaceChildren();
        container._renderedMarkdown = '';
        return;
    }
    const markdown = String(source);
    if (!markdown.trim()) {
        if (container.hasChildNodes()) container.replaceChildren();
        container._renderedMarkdown = '';
        return;
    }
    if (container._renderedMarkdown === markdown) {
        return;
    }
    container._renderedMarkdown = markdown;

    if (!markdownRenderer) markdownRenderer = createMarkdownRenderer();
    const html = sanitizeHtml(markdownRenderer.render(markdown));
    container.innerHTML = html;
}
