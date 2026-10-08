export function createLoadingIndicator(label = 'Thinking…') {
    const wrapper = document.createElement('div');
    wrapper.className = 'loading-state';
    wrapper.setAttribute('role', 'status');
    wrapper.setAttribute('aria-live', 'polite');

    const spinner = document.createElement('span');
    spinner.className = 'loading-spinner';
    spinner.setAttribute('aria-hidden', 'true');

    const text = document.createElement('span');
    text.className = 'loading-label';
    text.textContent = label;
    wrapper.append(spinner, text);

    return {
        element: wrapper,
        setLabel(value) {
            text.textContent = value;
        },
        remove() {
            wrapper.remove();
        },
    };
}
