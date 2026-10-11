const HTML_ALLOWED_TAGS = [
    'a', 'abbr', 'b', 'blockquote', 'br', 'code', 'dd', 'del', 'details',
    'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4',
    'h5', 'h6', 'hr', 'i', 'img', 'input', 'kbd', 'li', 'mark', 'ol', 'p', 'pre',
    'q', 's', 'samp', 'section', 'small', 'span', 'strong', 'sub', 'summary', 'sup',
    'table', 'tbody', 'td', 'th', 'thead', 'tr', 'u', 'ul', 'svg', 'path',
    'annotation', 'math', 'menclose', 'merror', 'mfenced', 'mfrac', 'mglyph',
    'mi', 'mlabeledtr', 'mmultiscripts', 'mn', 'mo', 'mover', 'mpadded',
    'mphantom', 'mroot', 'mrow', 'ms', 'mspace', 'msqrt', 'mstyle', 'msub',
    'msubsup', 'msup', 'mtable', 'mtd', 'mtext', 'mtr', 'munder', 'munderover',
    'semantics'
];

const HTML_ALLOWED_ATTRS = [
    'alt', 'aria-hidden', 'aria-label', 'accent', 'accentunder', 'actiontype', 'bevelled',
    'checked', 'class', 'columnalign', 'columnlines', 'columnspacing', 'colspan',
    'decoding', 'depth', 'disabled', 'display', 'encoding', 'fence', 'height', 'href',
    'id', 'largeop', 'lspace', 'mathbackground', 'mathcolor', 'mathvariant', 'maxsize',
    'minsize', 'movablelimits', 'notation', 'open', 'rowalign', 'rowlines', 'rowspacing',
    'rowspan', 'scope', 'scriptlevel', 'separator', 'style', 'src',
    'start', 'stretchy', 'title', 'type', 'viewbox', 'voffset', 'width', 'xmlns',
    'xmlns:xlink', 'd', 'fill', 'focusable', 'data-language', 'loading', 'rel',
    'role', 'target', 'align', 'tabindex'
];

const HTML_ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);
const HTML_FORBIDDEN_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed', 'form']);
const HTML_ALLOWED_TAG_SET = new Set(HTML_ALLOWED_TAGS);
const HTML_ALLOWED_ATTR_SET = new Set(HTML_ALLOWED_ATTRS);

function escapeHtml(html) {
    return html
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function sanitizeWithBrowserDom(html, doc) {
    const template = doc.createElement('template');
    template.innerHTML = html;

    function sanitizeChildren(parent) {
        for (const child of Array.from(parent.childNodes)) {
            if (child.nodeType !== 1) {
                if (child.nodeType !== 3) child.remove();
                continue;
            }

            const tagName = child.localName.toLowerCase();
            if (HTML_FORBIDDEN_TAGS.has(tagName)) {
                child.remove();
                continue;
            }

            for (const attribute of Array.from(child.attributes)) {
                const name = attribute.name.toLowerCase();
                const value = attribute.value;
                const urlAttribute = name === 'href' || name === 'src';
                let allowed = HTML_ALLOWED_ATTR_SET.has(name) && !name.startsWith('on');

                if (urlAttribute) {
                    try {
                        const url = new URL(value, doc.baseURI);
                        allowed = allowed && HTML_ALLOWED_PROTOCOLS.has(url.protocol.toLowerCase());
                    } catch {
                        allowed = false;
                    }
                }

                if (
                    name === 'style'
                    && /(?:url\s*\(|expression\s*\(|@import|behavior\s*:|-moz-binding)/i.test(value)
                ) {
                    allowed = false;
                }

                if (!allowed || name === 'srcdoc') child.removeAttribute(attribute.name);
            }

            sanitizeChildren(child);
            if (!HTML_ALLOWED_TAG_SET.has(tagName)) {
                child.replaceWith(...Array.from(child.childNodes));
            } else if (tagName === 'a' && child.getAttribute('target') === '_blank') {
                child.setAttribute('rel', 'noopener noreferrer');
            }
        }
    }

    sanitizeChildren(template.content);
    return template.innerHTML;
}

export function sanitizeHtml(rawHtml) {
    const html = String(rawHtml ?? '');
    if (!html) return '';
    const dom = typeof globalThis !== 'undefined' ? globalThis : undefined;
    const domPurify = dom?.DOMPurify;
    if (domPurify && typeof domPurify.sanitize === 'function') {
        return domPurify.sanitize(html, {
            ALLOWED_TAGS: HTML_ALLOWED_TAGS,
            ALLOWED_ATTR: HTML_ALLOWED_ATTRS,
            FORBID_TAGS: [...HTML_FORBIDDEN_TAGS],
            FORBID_ATTR: ['srcdoc'],
            ALLOW_UNKNOWN_PROTOCOLS: false,
            ALLOW_DATA_ATTR: false,
            ADD_ATTR: ['data-language'],
            SANITIZE_NAMED_PROPS: true,
            RETURN_DOM: false,
        });
    }

    if (dom?.document?.createElement) {
        return sanitizeWithBrowserDom(html, dom.document);
    }

    return escapeHtml(html);
}

export function renderHtmlFragment(parent, rawHtml, options = {}) {
    const doc = typeof globalThis !== 'undefined' ? globalThis.document : null;
    if (!parent || !doc || typeof doc.createElement !== 'function') {
        return null;
    }
    const safeHtml = sanitizeHtml(rawHtml);
    if (!safeHtml) return null;
    const element = doc.createElement(options.containerTag || 'div');
    element.className = options.className || 'rendered-html';
    element.innerHTML = safeHtml;
    parent.append(element);
    return element;
}

export function normalizeHtmlFragment(rawHtml) {
    return sanitizeHtml(rawHtml);
}

export { HTML_ALLOWED_TAGS, HTML_ALLOWED_ATTRS, HTML_ALLOWED_PROTOCOLS };
export default {
    HTML_ALLOWED_TAGS,
    HTML_ALLOWED_ATTRS,
    HTML_ALLOWED_PROTOCOLS,
    sanitizeHtml,
    renderHtmlFragment,
    normalizeHtmlFragment,
};
