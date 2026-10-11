export function renderStreamDetails(container, details) {
    if (!details || (
        !details.provider && !details.model && !details.context_length
        && !details.sources?.length
    )) return;
    container.replaceChildren();

    if (Array.isArray(details.sources)) {
        const sourceFooter = document.createElement('footer');
        sourceFooter.className = 'source-footer';
        const label = document.createElement('span');
        label.className = 'source-footer-label';
        label.textContent = 'Sources';
        const sources = document.createElement('div');
        sources.className = 'source-pills';
        const seenUrls = new Set();
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
            const title = typeof source.title === 'string' && source.title.trim()
                ? source.title.trim()
                : hostname;
            pill.title = title;
            pill.setAttribute('aria-label', `Open source: ${title}`);
            pill.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="6.25"></circle><path d="M1.9 8h12.2M8 1.75c1.65 1.7 2.45 3.78 2.45 6.25S9.65 12.55 8 14.25C6.35 12.55 5.55 10.47 5.55 8S6.35 3.45 8 1.75Z"></path></svg>';
            const linkLabel = document.createElement('span');
            linkLabel.textContent = title;
            pill.append(linkLabel);
            sources.append(pill);
        }
        if (sources.childElementCount) {
            sourceFooter.append(label, sources);
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
        const totalTokens = new Intl.NumberFormat().format(promptTokens + completionTokens);
        usage.push(
            `Tokens: ${totalTokens} (${promptTokens} prompt · ${completionTokens} completion)`,
        );
    }
    if (Number.isFinite(details.context_length) && details.context_length > 0) {
        usage.push(
            `Model context window: ${new Intl.NumberFormat().format(details.context_length)} tokens`,
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