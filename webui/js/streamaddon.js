function normalizeSourceLabel(value) {
    return value.normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/đ/g, 'd')
        .replace(/[^a-z0-9]/g, '');
}

export function removeInlineSourceCitations(content, sources) {
    if (!Array.isArray(sources) || sources.length === 0) return content;

    const sourceLabels = new Set();
    const ignoredHostLabels = new Set([
        'www', 'm', 'mobile', 'news', 'en', 'amp',
        'com', 'org', 'net', 'edu', 'gov', 'co', 'vn', 'uk', 'io',
    ]);
    for (const source of sources) {
        if (typeof source?.url !== 'string') continue;
        try {
            const url = new URL(source.url);
            if (!['http:', 'https:'].includes(url.protocol)) continue;
            for (const label of url.hostname.toLowerCase().split('.')) {
                if (!ignoredHostLabels.has(label)) sourceLabels.add(normalizeSourceLabel(label));
            }
        } catch {
            continue;
        }
    }
    if (sourceLabels.size === 0) return content;

    return String(content ?? '')
        .replace(/【\s*\d+(?:\s*[,，、]\s*\d+)*\s*】/g, '')
        .replace(/\[(?:\d+\s*(?:[,，、]\s*\d+\s*)*)\]/g, '')
        .replace(/\(([^()\n]{2,160})\)/g, (citation, labels) => {
            const citedSources = labels
                .split(/\s*(?:,|;|\/|&|\band\b|\bvà\b)\s*/i)
                .map(normalizeSourceLabel)
                .filter(Boolean);
            return citedSources.length > 0 && citedSources.every(label => sourceLabels.has(label))
                ? ''
                : citation;
        })
        .replace(/[ \t]+([,.;!?])/g, '$1')
        .replace(/[ \t]{2,}/g, ' ');
}

export function renderStreamDetails(container, details) {
    const hasTokenUsage = (
        Number.isFinite(details?.prompt_tokens) && details.prompt_tokens > 0
    ) || (
        Number.isFinite(details?.completion_tokens) && details.completion_tokens > 0
    );
    if (!details || (
        !details.provider && !details.model && !details.sources?.length
        && !hasTokenUsage
    )) return;
    container.replaceChildren();

    if (Array.isArray(details.sources)) {
        const sourceFooter = document.createElement('footer');
        sourceFooter.className = 'source-footer';
        const sources = document.createElement('div');
        sources.className = 'source-pills';
        const seenUrls = new Set();
        let pillIndex = 0;
        for (const source of details.sources) {
            if (!source || typeof source.url !== 'string') continue;
            let url;
            try {
                url = new URL(source.url);
            } catch {
                continue;
            }
            if (!['http:', 'https:'].includes(url.protocol)) continue;
            const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
            if (!hostname || seenUrls.has(url.href)) continue;
            seenUrls.add(url.href);

            const pill = document.createElement('a');
            pill.className = 'source-pill';
            pill.href = url.href;
            pill.target = '_blank';
            pill.rel = 'noopener noreferrer';
            pill.style.setProperty('--pill-index', String(pillIndex++));
            const title = typeof source.title === 'string' && source.title.trim()
                ? source.title.trim()
                : hostname;
            pill.title = `${title}\n${url.href}`;
            pill.setAttribute('aria-label', `Open source: ${title}`);

            const iconWrap = document.createElement('span');
            iconWrap.className = 'source-pill-favicon-wrap';
            iconWrap.innerHTML = '<svg class="source-pill-globe" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="6.25"></circle><path d="M1.9 8h12.2M8 1.75c1.65 1.7 2.45 3.78 2.45 6.25S9.65 12.55 8 14.25C6.35 12.55 5.55 10.47 5.55 8S6.35 3.45 8 1.75Z"></path></svg>';

            const icon = document.createElement('img');
            icon.className = 'source-pill-icon';
            icon.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=32`;
            icon.alt = '';
            icon.loading = 'eager';
            icon.fetchPriority = 'low';
            icon.decoding = 'async';
            icon.referrerPolicy = 'no-referrer';
            icon.setAttribute('aria-hidden', 'true');
            icon.addEventListener('load', () => {
                pill.dataset.hasFavicon = 'true';
            });
            icon.addEventListener('error', () => {
                pill.dataset.hasFavicon = 'false';
                icon.remove();
            });
            iconWrap.append(icon);

            const linkLabel = document.createElement('span');
            linkLabel.className = 'source-pill-title';
            linkLabel.textContent = title;

            const domainLabel = document.createElement('span');
            domainLabel.className = 'source-pill-domain';
            domainLabel.textContent = hostname;

            const arrowIcon = document.createElement('span');
            arrowIcon.className = 'source-pill-arrow';
            arrowIcon.innerHTML = '<svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12 12 4M6 4h6v6"/></svg>';

            pill.append(iconWrap, linkLabel, domainLabel, arrowIcon);
            sources.append(pill);
        }
        if (sources.childElementCount) {
            sourceFooter.append(sources);
            container.append(sourceFooter);
        }
    }

    if (details.provider || details.model) {
        const label = document.createElement('span');
        label.className = 'stream-details-label';
        label.textContent = [details.provider, details.model].filter(Boolean).join(' · ');
        container.append(label);
    }

    const promptTokens = Number.isFinite(details.prompt_tokens) ? details.prompt_tokens : 0;
    const completionTokens = Number.isFinite(details.completion_tokens)
        ? details.completion_tokens
        : 0;
    const usage = [];
    if (promptTokens > 0 || completionTokens > 0) {
        const formatter = new Intl.NumberFormat();
        const totalTokens = formatter.format(promptTokens + completionTokens);
        usage.push(
            `Tokens: ${totalTokens} (${formatter.format(promptTokens)} prompt · ${formatter.format(completionTokens)} answer)`,
        );
    }
    if (usage.length) {
        const usageLabel = document.createElement('span');
        usageLabel.className = 'stream-details-usage';
        usageLabel.textContent = usage.join(' · ');
        container.append(usageLabel);
    }
}

export function addCodeCopyControls(container) {
    for (const pre of container.querySelectorAll('pre:not([data-copy-ready])')) {
        pre.dataset.copyReady = 'true';
        const code = pre.querySelector('code');
        if (!code) continue;

        const toolbar = document.createElement('div');
        toolbar.className = 'code-toolbar';
        const language = document.createElement('span');
        language.className = 'code-language';
        language.textContent = code.dataset.language || 'code';

        const copy = document.createElement('button');
        copy.className = 'code-copy';
        copy.type = 'button';
        copy.textContent = 'Copy';
        copy.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(code.textContent);
                copy.textContent = 'Copied';
                window.setTimeout(() => { copy.textContent = 'Copy'; }, 1_500);
            } catch (error) {
                console.error('[WEBUI] Could not copy code:', error);
                copy.textContent = 'Copy failed';
                window.setTimeout(() => { copy.textContent = 'Copy'; }, 1_500);
            }
        });

        toolbar.append(language, copy);
        pre.prepend(toolbar);
    }
}