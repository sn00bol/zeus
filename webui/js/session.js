const sessionKey = 'zeus.webui.conversationId';
const bootKey = 'zeus.webui.bootId';
const memoryUserKey = 'zeus.webui.memoryUserId';

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

export function getMemoryUserId() {
    let id = localStorage.getItem(memoryUserKey);
    if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
        id = createSessionId();
        localStorage.setItem(memoryUserKey, id);
    }
    return id;
}

export function startNewSession() {
    const id = createSessionId();
    localStorage.setItem(sessionKey, id);
    window.dispatchEvent(new CustomEvent('zeus:session-change', { detail: id }));
    return id;
}

export function selectSession(id) {
    localStorage.setItem(sessionKey, id);
    window.dispatchEvent(new CustomEvent('zeus:session-change', { detail: id }));
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
    messageContainer = messagesElement,
}) {
    if (typeof sessionId === 'string' && sessionId.startsWith('temp-')) {
        messageContainer.replaceChildren();
        if (welcomeElement) welcomeElement.hidden = false;
        return true;
    }
    try {
        const { messages } = await api(`/api/history?conversationId=${encodeURIComponent(sessionId)}`);
        messageContainer.replaceChildren();
        for (const message of messages) {
            if (message.role !== 'user' && message.role !== 'assistant') continue;
            const rendered = addMessage(message.role, message.content, {
                thinking: message.thinking,
                sources: Array.isArray(message.sources) ? message.sources : [],
                tools: Array.isArray(message.tools) ? message.tools : [],
                attachments: Array.isArray(message.attachments) ? message.attachments : [],
            }, messageContainer);
            if (message.role === 'assistant') {
                renderStreamDetails(rendered.details, {
                    prompt_tokens: Number(message.usage?.prompt_tokens),
                    completion_tokens: Number(message.usage?.completion_tokens),
                    context_length: Number(message.usage?.context_length),
                    provider: message.provider,
                    model: message.model,
                    sources: Array.isArray(message.sources) ? message.sources : [],
                });
            }
        }
        if (messageContainer.isConnected) {
            welcomeElement.hidden = messageContainer.childElementCount > 0;
            loadingElement.hidden = true;
            scrollToLatest();
        }
        return messageContainer.childElementCount === 0;
    } catch (error) {
        if (messageContainer.isConnected) {
            loadingElement.textContent = 'Could not load conversation history.';
        }
        throw error;
    }
}