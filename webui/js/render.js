const INLINE_TOKEN_PATTERN = /(`[^`]*`|\*\*[\s\S]+?\*\*|__[\s\S]+?__|~~[\s\S]+?~~|\*[^*\n]+\*|_[^_\n]+_|\[[^\]]+\]\([^)]+\))/g;

function appendInline(parent, text) {
    const parts = text.split(INLINE_TOKEN_PATTERN);
    for (const part of parts) {
        if (!part) continue;
        let element = null;
        if (part.startsWith('**') && part.endsWith('**')) {
            element = document.createElement('strong');
            element.textContent = part.slice(2, -2);
        } else if (part.startsWith('__') && part.endsWith('__')) {
            element = document.createElement('strong');
            element.textContent = part.slice(2, -2);
        } else if (part.startsWith('~~') && part.endsWith('~~')) {
            element = document.createElement('del');
            element.textContent = part.slice(2, -2);
        } else if (part.startsWith('`') && part.endsWith('`')) {
            element = document.createElement('code');
            element.textContent = part.slice(1, -1);
        } else if (part.startsWith('*') && part.endsWith('*')) {
            element = document.createElement('em');
            element.textContent = part.slice(1, -1);
        } else if (part.startsWith('_') && part.endsWith('_')) {
            element = document.createElement('em');
            element.textContent = part.slice(1, -1);
        } else {
            const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
            if (linkMatch) {
                let safeUrl;
                try {
                    const parsedUrl = new URL(linkMatch[2], window.location.href);
                    if (['http:', 'https:', 'mailto:'].includes(parsedUrl.protocol)) {
                        safeUrl = parsedUrl.href;
                    }
                } catch {
                    safeUrl = null;
                }
                if (safeUrl) {
                    element = document.createElement('a');
                    element.href = safeUrl;
                    element.rel = 'noopener noreferrer';
                    element.target = '_blank';
                    element.textContent = linkMatch[1];
                }
            }
        }
        parent.append(element || document.createTextNode(part));
    }
}

function appendParagraph(parent, lines) {
    const paragraph = document.createElement('p');
    lines.forEach((line, index) => {
        if (index > 0) paragraph.append(document.createElement('br'));
        appendInline(paragraph, line);
    });
    parent.append(paragraph);
}

export function renderMessageContent(container, source) {
    container.replaceChildren();
    const lines = String(source).replace(/\r\n?/g, '\n').split('\n');
    let paragraph = [];
    const flushParagraph = () => {
        if (paragraph.length) appendParagraph(container, paragraph);
        paragraph = [];
    };

    for (let index = 0; index < lines.length;) {
        const line = lines[index];
        const fence = line.match(/^\s*```([\w.+#-]*)\s*$/);
        if (fence) {
            flushParagraph();
            const codeLines = [];
            index += 1;
            while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
                codeLines.push(lines[index]);
                index += 1;
            }
            if (index < lines.length) index += 1;
            const pre = document.createElement('pre');
            const code = document.createElement('code');
            code.textContent = codeLines.join('\n');
            if (fence[1]) code.dataset.language = fence[1];
            pre.append(code);
            container.append(pre);
            continue;
        }

        const heading = line.match(/^(#{1,3})\s+(.+)$/);
        if (heading) {
            flushParagraph();
            const element = document.createElement(`h${heading[1].length}`);
            appendInline(element, heading[2]);
            container.append(element);
            index += 1;
            continue;
        }

        const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
        const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
        if (unordered || ordered) {
            flushParagraph();
            const list = document.createElement(unordered ? 'ul' : 'ol');
            while (index < lines.length) {
                const match = lines[index].match(
                    unordered ? /^\s*[-*+]\s+(.+)$/ : /^\s*\d+[.)]\s+(.+)$/,
                );
                if (!match) break;
                const item = document.createElement('li');
                appendInline(item, match[1]);
                list.append(item);
                index += 1;
            }
            container.append(list);
            continue;
        }

        if (!line.trim()) {
            flushParagraph();
            index += 1;
            continue;
        }
        paragraph.push(line);
        index += 1;
    }
    flushParagraph();
}
