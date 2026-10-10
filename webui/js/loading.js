export function createLoadingIndicator(label = 'Thinking…') {
    const wrapper = document.createElement('div');
    wrapper.className = 'loading-state';
    wrapper.setAttribute('role', 'status');
    wrapper.setAttribute('aria-live', 'polite');

    const row = document.createElement('div');
    row.className = 'loading-row';

    const spinner = document.createElement('span');
    spinner.className = 'loading-spinner';
    spinner.setAttribute('aria-hidden', 'true');

    const text = document.createElement('span');
    text.className = 'loading-label';
    text.textContent = label;

    const toggle = document.createElement('button');
    toggle.className = 'thinking-toggle';
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Toggle model thinking');
    toggle.title = 'View reasoning process';
    toggle.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

    const panel = document.createElement('div');
    panel.className = 'thinking-panel';
    panel.hidden = true;

    const thinkingContent = document.createElement('pre');
    thinkingContent.className = 'thinking-text';
    thinkingContent.textContent = 'Waiting for model reasoning…';
    panel.append(thinkingContent);

    row.append(spinner, text, toggle);
    wrapper.append(row, panel);

    let expanded = false;
    let thinking = '';
    let isFinished = false;
    const startTime = Date.now();
    let timerId = null;

    const updateTimer = () => {
        if (isFinished) return;
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        text.textContent = `Thinking… ${elapsed}s`;
    };

    timerId = setInterval(updateTimer, 200);

    const syncToggle = () => {
        toggle.setAttribute('aria-expanded', String(expanded));
        toggle.setAttribute('aria-label', expanded ? 'Hide model thinking' : 'Show model thinking');
        panel.hidden = !expanded;
    };

    row.addEventListener('click', (e) => {
        // Allow clicking either the toggle button or row to expand/collapse
        if (e.target.closest('.loading-spinner')) return;
        expanded = !expanded;
        wrapper.classList.toggle('thinking-open', expanded);
        syncToggle();
    });

    return {
        element: wrapper,
        setLabel(value) {
            text.textContent = value;
        },
        appendThinking(value) {
            if (!value) return;
            thinking += value;
            thinkingContent.textContent = thinking;
            if (expanded) {
                panel.scrollTop = panel.scrollHeight;
            }
        },
        setThinking(value) {
            thinking = value || '';
            thinkingContent.textContent = thinking || 'No reasoning text recorded.';
            if (expanded) {
                panel.scrollTop = panel.scrollHeight;
            }
        },
        finish() {
            if (isFinished) return;
            isFinished = true;
            if (timerId) {
                clearInterval(timerId);
                timerId = null;
            }
            spinner.remove();

            if (thinking.trim()) {
                const totalSeconds = Math.max(0.1, (Date.now() - startTime) / 1000).toFixed(1);
                text.textContent = `Thought for ${totalSeconds}s`;
                wrapper.classList.add('thinking-finished');
                syncToggle();
                return;
            }

            // If no thinking content was generated, clean up wrapper
            wrapper.remove();
        },
        remove() {
            if (timerId) clearInterval(timerId);
            wrapper.remove();
        },
    };
}

export function createFinishedThinking(thinkingText) {
    if (!thinkingText || !thinkingText.trim()) return null;

    const wrapper = document.createElement('div');
    wrapper.className = 'loading-state thinking-finished';

    const row = document.createElement('div');
    row.className = 'loading-row';
    row.style.cursor = 'pointer';

    const brainIcon = document.createElement('span');
    brainIcon.className = 'thinking-icon';
    brainIcon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-2.54z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-2.54z"/></svg>';

    const label = document.createElement('span');
    label.className = 'loading-label';
    label.textContent = 'Thought';

    const toggle = document.createElement('button');
    toggle.className = 'thinking-toggle';
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Show model thinking');
    toggle.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m6 9 6 6 6-6"/></svg>';

    const panel = document.createElement('div');
    panel.className = 'thinking-panel';
    panel.hidden = true;

    const pre = document.createElement('pre');
    pre.className = 'thinking-text';
    pre.textContent = thinkingText;
    panel.append(pre);

    row.append(brainIcon, label, toggle);
    wrapper.append(row, panel);

    let expanded = false;
    row.addEventListener('click', () => {
        expanded = !expanded;
        wrapper.classList.toggle('thinking-open', expanded);
        toggle.setAttribute('aria-expanded', String(expanded));
        panel.hidden = !expanded;
    });

    return wrapper;
}
