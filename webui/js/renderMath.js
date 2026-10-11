const KATEX_VERSION = '0.16.22';
const DEFAULT_MATH_OPTIONS = Object.freeze({
    displayMode: false,
    throwOnError: false,
    trust: false,
    strict: false,
    output: 'htmlAndMathml',
    maxSize: 1000,
    maxExpand: 20,
});

function getKatex() {
    const globalScope = typeof globalThis !== 'undefined' ? globalThis : undefined;
    if (!globalScope) return null;
    return globalScope.katex || null;
}

function getDocument() {
    const globalScope = typeof globalThis !== 'undefined' ? globalThis : undefined;
    if (!globalScope) return null;
    return globalScope.document || null;
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function renderMathToHtml(rawText, displayMode = false) {
    const text = String(rawText ?? '').trim();
    const katex = getKatex();
    if (!katex || typeof katex.renderToString !== 'function') {
        return `<span class="math-fallback">${escapeHtml(text)}</span>`;
    }

    try {
        return katex.renderToString(text, {
            ...DEFAULT_MATH_OPTIONS,
            displayMode,
            macros: {},
        });
    } catch {
        console.warn('[WEBUI] KaTeX render failed.');
        return `<span class="math-fallback">${escapeHtml(text)}</span>`;
    }
}

export function renderMathText(rawText, options = {}) {
    const text = String(rawText ?? '').trim();
    const doc = getDocument();
    if (!doc && typeof rawText === 'string') return rawText;
    if (!text) return doc ? doc.createTextNode('') : '';

    const element = doc.createElement(options.displayMode ? 'div' : 'span');
    element.className = options.displayMode ? 'katex-display math-block' : 'katex-inline math-inline';
    element.innerHTML = renderMathToHtml(text, Boolean(options.displayMode));
    return element;
}

export function renderMathInElement(parent, rawText, options = {}) {
    const node = renderMathText(rawText, options);
    if (parent && typeof parent.append === 'function') {
        parent.append(node);
    }
    return node;
}

export function extractMathSegments(source) {
    const text = String(source ?? '');
    const segments = [];
    let cursor = 0;
    const pattern = /(\$\$.*?\$\$|\\\(.*?\\\)|\\\[.*?\\\]|\$.*?\$)/g;
    let match;

    while ((match = pattern.exec(text)) !== null) {
        if (match.index > cursor) {
            segments.push({ type: 'text', value: text.slice(cursor, match.index) });
        }
        segments.push({ type: 'math', value: match[0], raw: match[0] });
        cursor = match.index + match[0].length;
    }

    if (cursor < text.length) {
        segments.push({ type: 'text', value: text.slice(cursor) });
    }

    return segments;
}

export function normalizeMathSource(value) {
    return String(value ?? '').trim();
}

export { KATEX_VERSION };
export default {
    KATEX_VERSION,
    renderMathToHtml,
    renderMathText,
    renderMathInElement,
    extractMathSegments,
    normalizeMathSource,
};
