const sessionKey = 'zeus.webui.conversationId';
const bootKey = 'zeus.webui.bootId';

export function createSessionId() {
    return typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function getSessionId() {
    const bootId = document.querySelector('meta[name="zeus-boot-id"]')?.content;
    let id = localStorage.getItem(sessionKey);
    if (bootId && localStorage.getItem(bootKey) !== bootId) {
        id = createSessionId();
        localStorage.setItem(bootKey, bootId);
        localStorage.setItem(sessionKey, id);
    } else if (!id) {
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
            const rendered = addMessage(message.role, message.content, {
                thinking: message.thinking,
                sources: Array.isArray(message.sources) ? message.sources : [],
            });
            if (message.role === 'assistant' && message.usage) {
                renderStreamDetails(rendered.details, {
                    prompt_tokens: Number(message.usage.prompt_tokens),
                    completion_tokens: Number(message.usage.completion_tokens),
                    context_length: Number(message.usage.context_length),
                    provider: message.provider,
                    model: message.model,
                    sources: Array.isArray(message.sources) ? message.sources : [],
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