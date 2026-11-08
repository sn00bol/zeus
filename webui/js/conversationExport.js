function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => (
        {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
        }[character]
    ));
}

function renderMessages(messages) {
    return messages
        .filter(message => message.role === 'user' || message.role === 'assistant')
        .map(message => {
            const role = message.role === 'user' ? 'You' : 'ZEUS';
            const content = message.html || '<p></p>';
            return `<article class="export-message">
                <h2>${role}</h2>
                <div class="export-message-content">${content}</div>
            </article>`;
        })
        .join('\n');
}

function buildConversationExportPage({
    title,
    messages,
    exportedAt = '',
    katexStylesheetUrl = '',
}) {
    const stylesheet = katexStylesheetUrl
        ? `<link rel="stylesheet" href="${escapeHtml(katexStylesheetUrl)}">`
        : '';
    return `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="ProgId" content="Word.Document">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    ${stylesheet}
    <style>
        @page {
            size: A4;
            margin: 18mm 18mm 20mm;
        }
        @page WordSection1 {
            size: 21cm 29.7cm;
            margin: 18mm 18mm 20mm;
            mso-header-margin: 9mm;
            mso-footer-margin: 9mm;
        }
        * { box-sizing: border-box; }
        body {
            margin: 0;
            color: #202124;
            background: #fff;
            font: 10.5pt/1.55 Arial, Helvetica, sans-serif;
            overflow-wrap: anywhere;
        }
        .WordSection1 { page: WordSection1; }
        h1 {
            margin: 0 0 6mm;
            padding-bottom: 3mm;
            border-bottom: 1px solid #d5d9df;
            color: #111827;
            font-size: 22pt;
            line-height: 1.2;
        }
        .exported-at {
            margin: 0 0 10mm;
            color: #6b7280;
            font-size: 9pt;
        }
        .export-message {
            margin: 0 0 9mm;
            page-break-inside: auto;
            break-inside: auto;
        }
        .export-message h2 {
            margin: 0 0 3mm;
            padding-bottom: 1.5mm;
            border-bottom: 1px solid #e5e7eb;
            color: #374151;
            font-size: 10pt;
            page-break-after: avoid;
            break-after: avoid;
        }
        .export-message-content { font-size: 10.5pt; line-height: 1.55; }
        .export-message-content > :first-child { margin-top: 0; }
        .export-message-content > :last-child { margin-bottom: 0; }
        .export-message-content p { margin: 0 0 3mm; }
        .export-message-content h1, .export-message-content h2,
        .export-message-content h3, .export-message-content h4,
        .export-message-content h5, .export-message-content h6 {
            margin: 5mm 0 2mm;
            border: 0;
            color: #111827;
            line-height: 1.3;
            page-break-after: avoid;
            break-after: avoid;
        }
        .export-message-content h1 { font-size: 17pt; }
        .export-message-content h2 { font-size: 15pt; }
        .export-message-content h3 { font-size: 13pt; }
        .export-message-content h4, .export-message-content h5,
        .export-message-content h6 { font-size: 11pt; }
        .export-message-content ul, .export-message-content ol {
            margin: 2mm 0 4mm;
            padding-left: 7mm;
        }
        .export-message-content li { margin: 1mm 0; }
        .export-message-content a { color: #1d4ed8; text-decoration: underline; }
        .export-message-content blockquote {
            margin: 3mm 0;
            padding: 2mm 4mm;
            border-left: 3px solid #9ca3af;
            background: #f3f4f6;
            color: #374151;
        }
        .export-message-content blockquote p { margin: 0; }
        .export-message-content code {
            font: 9pt/1.45 Consolas, "Courier New", monospace;
        }
        .export-message-content p code, .export-message-content li code {
            padding: .3mm 1mm;
            border: 1px solid #e5e7eb;
            border-radius: 2px;
            background: #f3f4f6;
        }
        .export-message-content pre {
            margin: 3mm 0 4mm;
            padding: 3mm;
            border: 1px solid #d1d5db;
            background: #f8fafc;
            white-space: pre-wrap;
            overflow-wrap: anywhere;
            page-break-inside: auto;
            break-inside: auto;
        }
        .export-message-content pre code { white-space: pre-wrap; }
        .export-message-content table, .export-message-content .markdown-table {
            width: 100%;
            margin: 3mm 0 4mm;
            border-collapse: collapse;
            font-size: 9.5pt;
        }
        .export-message-content thead { display: table-header-group; }
        .export-message-content tr { break-inside: avoid; page-break-inside: avoid; }
        .export-message-content th, .export-message-content td {
            padding: 2mm;
            border: 1px solid #cbd5e1;
            color: #202124;
            text-align: left;
            vertical-align: top;
            overflow-wrap: anywhere;
        }
        .export-message-content th { background: #eef2f7; font-weight: bold; }
        .export-message-content hr {
            height: 0;
            margin: 5mm 0;
            border: 0;
            border-top: 1px solid #d1d5db;
        }
        .export-message-content img { max-width: 100%; height: auto; }
        .tok-kw { color: #1d4ed8; font-weight: bold; }
        .tok-str { color: #166534; }
        .tok-num { color: #be185d; }
        .tok-com { color: #64748b; font-style: italic; }
        .tok-builtin { color: #0e7490; }
        .tok-fn { color: #0369a1; }
        .tok-tag { color: #be123c; }
        .task-list-item-checkbox { margin-right: 2mm; }
        @media screen {
            body { max-width: 210mm; min-height: 297mm; margin: 12mm auto; padding: 18mm; box-shadow: 0 2mm 8mm #0002; }
        }
        @media print {
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            a { color: #1d4ed8; }
        }
    </style>
</head>
<body>
    <div class="WordSection1">
        <h1>${escapeHtml(title)}</h1>
        ${exportedAt ? `<p class="exported-at">${escapeHtml(exportedAt)}</p>` : ''}
        ${renderMessages(messages)}
    </div>
</body>
</html>`;
}

export { buildConversationExportPage };
