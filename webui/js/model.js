async function requestJson(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        headers: {
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...options.headers,
        },
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
    return result;
}

export async function getModelChoices(conversationId) {
    return requestJson(`/api/models?conversationId=${encodeURIComponent(conversationId)}`);
}

export async function setModelChoice(conversationId, model) {
    return requestJson('/api/model-preference', {
        method: 'POST',
        body: JSON.stringify({
            conversationId,
            provider: model?.provider || 'auto',
            model: model?.model || 'auto',
        }),
    });
}
