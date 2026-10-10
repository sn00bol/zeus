/**
 * ZEUS High-Performance Markdown & Code Rendering Engine
 * Supports GFM Markdown, Syntax Highlighting, GFM Tables, Task Lists,
 * Blockquotes, Math/LaTeX equations, and Streaming-Safe DOM construction.
 */

// Safe link protocol validator
const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

function sanitizeUrl(rawUrl) {
    try {
        const parsed = new URL(rawUrl, window.location.href);
        return SAFE_PROTOCOLS.has(parsed.protocol) ? parsed.href : null;
    } catch {
        return null;
    }
}

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// Syntax Highlighting Engine
// ---------------------------------------------------------------------------

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

function highlightCode(rawCode, language) {
    const lang = (language || '').toLowerCase().trim();
    if (!rawCode) return '';

    // If language is plain text or unknown, return escaped text
    if (['txt', 'text', 'plain'].includes(lang)) {
        return escapeHtml(rawCode);
    }

    // Tokenize lines for fast, deterministic lexical highlighting
    const lines = rawCode.split('\n');
    const highlightedLines = lines.map(line => {
        let result = '';
        let i = 0;
        const len = line.length;

        while (i < len) {
            // Check for single-line comments (# or // or --)
            if (
                (line[i] === '#' && (lang === 'python' || lang === 'py' || lang === 'bash' || lang === 'sh' || lang === 'yaml' || lang === 'yml' || lang === 'dockerfile')) ||
                (line[i] === '/' && line[i + 1] === '/') ||
                (line[i] === '-' && line[i + 1] === '-' && (lang === 'sql' || lang === 'lua'))
            ) {
                const commentText = line.slice(i);
                result += `<span class="tok-com">${escapeHtml(commentText)}</span>`;
                break;
            }

            // Check for strings ('...', "...", `...`)
            if (line[i] === '"' || line[i] === "'" || line[i] === '`') {
                const quote = line[i];
                let j = i + 1;
                while (j < len && line[j] !== quote) {
                    if (line[j] === '\\') j += 1; // skip escape
                    j += 1;
                }
                if (j < len) j += 1; // include closing quote
                const strText = line.slice(i, j);
                result += `<span class="tok-str">${escapeHtml(strText)}</span>`;
                i = j;
                continue;
            }

            // Check for numbers
            if (/\d/.test(line[i]) && (i === 0 || /[\s,([{:+\-*\/=><]/.test(line[i - 1]))) {
                let j = i;
                if (line[j] === '0' && (line[j + 1] === 'x' || line[j + 1] === 'X')) j += 2;
                while (j < len && /[\d.a-fA-F_]/.test(line[j])) j += 1;
                const numText = line.slice(i, j);
                result += `<span class="tok-num">${escapeHtml(numText)}</span>`;
                i = j;
                continue;
            }

            // Check for words / identifiers
            if (/[a-zA-Z_$]/.test(line[i])) {
                let j = i;
                while (j < len && /[a-zA-Z0-9_$]/.test(line[j])) j += 1;
                const word = line.slice(i, j);

                if (KEYWORDS.has(word)) {
                    result += `<span class="tok-kw">${escapeHtml(word)}</span>`;
                } else if (BUILTINS.has(word)) {
                    result += `<span class="tok-builtin">${escapeHtml(word)}</span>`;
                } else if (j < len && line[j] === '(') {
                    // Function invocation or definition
                    result += `<span class="tok-fn">${escapeHtml(word)}</span>`;
                } else {
                    result += escapeHtml(word);
                }
                i = j;
                continue;
            }

            // HTML/XML tags
            if (line[i] === '<' && (lang === 'html' || lang === 'xml' || lang === 'jsx' || lang === 'tsx')) {
                const tagMatch = line.slice(i).match(/^<\/?([a-zA-Z0-9_-]+)/);
                if (tagMatch) {
                    result += `&lt;<span class="tok-tag">${escapeHtml(tagMatch[1])}</span>`;
                    i += tagMatch[0].length;
                    continue;
                }
            }

            // General punctuation or whitespace
            result += escapeHtml(line[i]);
            i += 1;
        }

        return result;
    });

    return highlightedLines.join('\n');
}

// ---------------------------------------------------------------------------
// LaTeX & Math Formatter (Lightweight Beautiful Symbol Engine)
// ---------------------------------------------------------------------------

const MATH_SYMBOLS = [
    [/\\times\b/g, '×'],
    [/\\div\b/g, '÷'],
    [/\\pm\b/g, '±'],
    [/\\leq\b/g, '≤'],
    [/\\geq\b/g, '≥'],
    [/\\neq\b/g, '≠'],
    [/\\approx\b/g, '≈'],
    [/\\infty\b/g, '∞'],
    [/\\alpha\b/g, 'α'],
    [/\\beta\b/g, 'β'],
    [/\\gamma\b/g, 'γ'],
    [/\\delta\b/g, 'δ'],
    [/\\theta\b/g, 'θ'],
    [/\\pi\b/g, 'π'],
    [/\\sigma\b/g, 'σ'],
    [/\\omega\b/g, 'ω'],
    [/\\sum\b/g, '∑'],
    [/\\int\b/g, '∫'],
    [/\\prod\b/g, '∏'],
    [/\\rightarrow\b/g, '→'],
    [/\\Rightarrow\b/g, '⇒'],
    [/\\leftarrow\b/g, '←'],
    [/\\cdot\b/g, '·'],
    [/\\sqrt\{([^}]+)\}/g, '√($1)'],
    [/\\frac\{([^}]+)\}\{([^}]+)\}/g, '($1 / $2)'],
];

function formatMathContent(mathText) {
    let clean = mathText.trim();
    for (const [pattern, replacement] of MATH_SYMBOLS) {
        clean = clean.replace(pattern, replacement);
    }
    return clean;
}

// ---------------------------------------------------------------------------
// Inline Markdown Parser
// ---------------------------------------------------------------------------

const INLINE_PATTERN = /(`[^`\n]+`|\$\$[^\n$]+\$\$|\$[^\n$]+\$|\*\*[\s\S]+?\*\*|__[\s\S]+?__|~~[\s\S]+?~~|==[\s\S]+?==|\*[^*\n]+\*|_[^_\n]+_|\[[^\]]+\]\([^)\n]+\))/g;

function appendInlineTokens(parent, text) {
    if (!text) return;
    const parts = text.split(INLINE_PATTERN);

    for (const part of parts) {
        if (!part) continue;

        // Block or Inline Math ($...$)
        if (part.startsWith('$$') && part.endsWith('$$') && part.length >= 4) {
            const math = document.createElement('span');
            math.className = 'math-block';
            math.textContent = formatMathContent(part.slice(2, -2));
            parent.append(math);
            continue;
        }

        if (part.startsWith('$') && part.endsWith('$') && part.length >= 3) {
            const math = document.createElement('span');
            math.className = 'math-inline';
            math.textContent = formatMathContent(part.slice(1, -1));
            parent.append(math);
            continue;
        }

        // Bold
        if ((part.startsWith('**') && part.endsWith('**') && part.length >= 4) ||
            (part.startsWith('__') && part.endsWith('__') && part.length >= 4)) {
            const strong = document.createElement('strong');
            appendInlineTokens(strong, part.slice(2, -2));
            parent.append(strong);
            continue;
        }

        // Strikethrough
        if (part.startsWith('~~') && part.endsWith('~~') && part.length >= 4) {
            const del = document.createElement('del');
            appendInlineTokens(del, part.slice(2, -2));
            parent.append(del);
            continue;
        }

        // Highlight ==mark==
        if (part.startsWith('==') && part.endsWith('==') && part.length >= 4) {
            const mark = document.createElement('mark');
            appendInlineTokens(mark, part.slice(2, -2));
            parent.append(mark);
            continue;
        }

        // Inline Code
        if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
            const code = document.createElement('code');
            code.className = 'inline-code';
            code.textContent = part.slice(1, -1);
            parent.append(code);
            continue;
        }

        // Italic
        if ((part.startsWith('*') && part.endsWith('*') && part.length >= 3) ||
            (part.startsWith('_') && part.endsWith('_') && part.length >= 3)) {
            const em = document.createElement('em');
            appendInlineTokens(em, part.slice(1, -1));
            parent.append(em);
            continue;
        }

        // Links [text](url)
        const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (linkMatch) {
            const safe = sanitizeUrl(linkMatch[2]);
            if (safe) {
                const a = document.createElement('a');
                a.href = safe;
                a.target = '_blank';
                a.rel = 'noopener noreferrer';
                a.textContent = linkMatch[1];
                parent.append(a);
                continue;
            }
        }

        parent.append(document.createTextNode(part));
    }
}

// ---------------------------------------------------------------------------
// Table Parsing
// ---------------------------------------------------------------------------

function isTableDelimiter(line) {
    if (!line || !line.includes('|')) return false;
    const trimmed = line.trim().replace(/^\||\|$/g, '');
    const cells = trimmed.split('|');
    if (!cells.length) return false;
    return cells.every(c => /^[\s:-]+$/.test(c) && c.includes('-'));
}

function parseTableAlignments(delimiterLine) {
    const trimmed = delimiterLine.trim().replace(/^\||\|$/g, '');
    return trimmed.split('|').map(cell => {
        const c = cell.trim();
        const left = c.startsWith(':');
        const right = c.endsWith(':');
        if (left && right) return 'center';
        if (right) return 'right';
        if (left) return 'left';
        return 'left';
    });
}

function parseTableRow(line) {
    return line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
}

// ---------------------------------------------------------------------------
// Main Markdown Block Renderer
// ---------------------------------------------------------------------------

export function renderMessageContent(container, source) {
    container.replaceChildren();
    if (!source) return;

    const lines = String(source).replace(/\r\n?/g, '\n').split('\n');
    let paragraphLines = [];

    const flushParagraph = () => {
        if (!paragraphLines.length) return;
        const p = document.createElement('p');
        paragraphLines.forEach((line, index) => {
            if (index > 0) p.append(document.createElement('br'));
            appendInlineTokens(p, line);
        });
        container.append(p);
        paragraphLines = [];
    };

    for (let index = 0; index < lines.length;) {
        const line = lines[index];

        // 1. Fenced Code Block (with Streaming Resilience)
        const fenceMatch = line.match(/^\s*```([\w.+#-]*)\s*$/);
        if (fenceMatch) {
            flushParagraph();
            const language = fenceMatch[1] || '';
            const codeLines = [];
            index += 1;

            while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
                codeLines.push(lines[index]);
                index += 1;
            }
            if (index < lines.length) index += 1; // skip closing fence if found

            const pre = document.createElement('pre');
            const code = document.createElement('code');
            const rawCode = codeLines.join('\n');
            if (language) code.dataset.language = language;

            // Highlight syntax
            code.innerHTML = highlightCode(rawCode, language);
            pre.append(code);
            container.append(pre);
            continue;
        }

        // 2. Math Block ($$...$$)
        if (/^\s*\$\$\s*$/.test(line)) {
            flushParagraph();
            const mathLines = [];
            index += 1;
            while (index < lines.length && !/^\s*\$\$\s*$/.test(lines[index])) {
                mathLines.push(lines[index]);
                index += 1;
            }
            if (index < lines.length) index += 1;
            const mathBlock = document.createElement('div');
            mathBlock.className = 'math-block-container';
            const mathText = document.createElement('span');
            mathText.className = 'math-block';
            mathText.textContent = formatMathContent(mathLines.join('\n'));
            mathBlock.append(mathText);
            container.append(mathBlock);
            continue;
        }

        // 3. Headings (H1 to H6)
        const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
        if (headingMatch) {
            flushParagraph();
            const level = headingMatch[1].length;
            const heading = document.createElement(`h${level}`);
            appendInlineTokens(heading, headingMatch[2]);
            container.append(heading);
            index += 1;
            continue;
        }

        // 4. Horizontal Rules
        if (/^\s*([*\-_])\s*(\1\s*){2,}\s*$/.test(line)) {
            flushParagraph();
            const hr = document.createElement('hr');
            hr.className = 'markdown-hr';
            container.append(hr);
            index += 1;
            continue;
        }

        // 5. Blockquotes (supports multi-line and nested)
        if (/^\s*>\s?/.test(line)) {
            flushParagraph();
            const quoteLines = [];
            while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
                quoteLines.push(lines[index].replace(/^\s*>\s?/, ''));
                index += 1;
            }
            const blockquote = document.createElement('blockquote');
            const innerP = document.createElement('p');
            quoteLines.forEach((qLine, qIdx) => {
                if (qIdx > 0) innerP.append(document.createElement('br'));
                appendInlineTokens(innerP, qLine);
            });
            blockquote.append(innerP);
            container.append(blockquote);
            continue;
        }

        // 6. GFM Tables
        if (line.includes('|') && index + 1 < lines.length && isTableDelimiter(lines[index + 1])) {
            flushParagraph();
            const table = document.createElement('table');
            table.className = 'markdown-table';

            const alignments = parseTableAlignments(lines[index + 1]);
            const headerCells = parseTableRow(line);

            const thead = document.createElement('thead');
            const headerRow = document.createElement('tr');
            headerCells.forEach((cell, i) => {
                const th = document.createElement('th');
                if (alignments[i]) th.style.textAlign = alignments[i];
                appendInlineTokens(th, cell);
                headerRow.append(th);
            });
            thead.append(headerRow);
            table.append(thead);

            index += 2; // skip header and delimiter

            const tbody = document.createElement('tbody');
            while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
                const rowCells = parseTableRow(lines[index]);
                const tr = document.createElement('tr');
                rowCells.forEach((cell, i) => {
                    const td = document.createElement('td');
                    if (alignments[i]) td.style.textAlign = alignments[i];
                    appendInlineTokens(td, cell);
                    tr.append(td);
                });
                tbody.append(tr);
                index += 1;
            }
            table.append(tbody);

            const tableWrap = document.createElement('div');
            tableWrap.className = 'table-wrapper';
            tableWrap.append(table);
            container.append(tableWrap);
            continue;
        }

        // 7. Task Lists & Standard Lists
        const taskMatch = line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.+)$/);
        const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
        const ordered = line.match(/^\s*(\d+)[.)]\s+(.+)$/);

        if (taskMatch || unordered || ordered) {
            flushParagraph();
            const isTask = Boolean(taskMatch);
            const isOrdered = Boolean(ordered) && !isTask;
            const list = document.createElement(isOrdered ? 'ol' : 'ul');
            if (isTask) list.className = 'task-list';

            while (index < lines.length) {
                const currentLine = lines[index];
                const currentTask = currentLine.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.+)$/);
                const currentUnordered = currentLine.match(/^\s*[-*+]\s+(.+)$/);
                const currentOrdered = currentLine.match(/^\s*\d+[.)]\s+(.+)$/);

                if (isTask && currentTask) {
                    const li = document.createElement('li');
                    li.className = 'task-item';
                    const checkbox = document.createElement('input');
                    checkbox.type = 'checkbox';
                    checkbox.disabled = true;
                    checkbox.checked = currentTask[1].toLowerCase() === 'x';
                    const span = document.createElement('span');
                    appendInlineTokens(span, currentTask[2]);
                    li.append(checkbox, span);
                    list.append(li);
                    index += 1;
                } else if (!isTask && isOrdered && currentOrdered) {
                    const li = document.createElement('li');
                    appendInlineTokens(li, currentOrdered[1]);
                    list.append(li);
                    index += 1;
                } else if (!isTask && !isOrdered && currentUnordered) {
                    const li = document.createElement('li');
                    appendInlineTokens(li, currentUnordered[1]);
                    list.append(li);
                    index += 1;
                } else {
                    break;
                }
            }

            container.append(list);
            continue;
        }

        // 8. Empty lines
        if (!line.trim()) {
            flushParagraph();
            index += 1;
            continue;
        }

        // Regular paragraph content
        paragraphLines.push(line);
        index += 1;
    }

    flushParagraph();
}
