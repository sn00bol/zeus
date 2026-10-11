export function renderStreamDetails(container, details) {
    if (!details || (
        !details.provider && !details.model && !details.context_length
    )) return;
    container.replaceChildren();

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
        usage.push(`Context: ${new Intl.NumberFormat().format(details.context_length)} tokens`);
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