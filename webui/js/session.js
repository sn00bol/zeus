const sessionKey = 'zeus.webui.conversationId';

export function createSessionId() {
    return typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function getSessionId() {
    let id = localStorage.getItem(sessionKey);
    if (!id) {
        id = createSessionId();
        localStorage.setItem(sessionKey, id);
    }
    return id;
}

export function startNewSession() {
    localStorage.setItem(sessionKey, createSessionId());
    window.location.reload();
}

export function selectSession(id) {
    localStorage.setItem(sessionKey, id);
    window.location.reload();
}

export async function loadSessionHistory({
    api,
    sessionId,
    messagesElement,
    welcomeElement,
    loadingElement,
    addMessage,
    renderStreamDetails,
    scrollToLatest,
}) {
    try {
        const { messages } = await api(`/api/history?conversationId=${encodeURIComponent(sessionId)}`);
        messagesElement.replaceChildren();
        for (const message of messages) {
            if (message.role !== 'user' && message.role !== 'assistant') continue;
            const rendered = addMessage(message.role, message.content, { thinking: message.thinking });
            if (message.role === 'assistant' && message.usage) {
                renderStreamDetails(rendered.details, {
                    prompt_tokens: Number(message.usage.prompt_tokens),
                    completion_tokens: Number(message.usage.completion_tokens),
                    provider: message.provider,
                    model: message.model,
                });
            }
        }
        welcomeElement.hidden = messagesElement.childElementCount > 0;
        loadingElement.hidden = true;
        scrollToLatest();
        return messagesElement.childElementCount === 0;
    } catch (error) {
        loadingElement.textContent = 'Could not load conversation history.';
        throw error;
    }
}