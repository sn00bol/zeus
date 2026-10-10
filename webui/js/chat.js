import { createLoadingIndicator, createFinishedThinking } from './loading.js';
import { getModelChoices, setModelChoice } from './model.js';
import { renderMessageContent } from './render.js';
import { addCodeCopyControls, renderStreamDetails } from './streamaddon.js';
import { startChatStream, watchChatStream } from './stream.js';
import { loadSessionHistory, getSessionId } from './session.js';
import { initializeSidebar } from './sidebar.js';

const conversationId = getSessionId();
const messagesElement = document.getElementById('messages');
const scrollElement = document.getElementById('chat-scroll');
const chatElement = document.querySelector('.chat');
const welcomeElement = document.getElementById('welcome');
const welcomeStage = document.getElementById('welcome-stage');
const composerWrap = document.getElementById('composer-wrap');
const chatFooter = document.getElementById('chat-footer');
const chatDock = document.getElementById('chat-dock');
const historyLoadingElement = document.getElementById('history-loading');
const form = document.getElementById('chat-form');
const input = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const modelButton = document.getElementById('model-picker-button');
const modelLabel = document.getElementById('model-picker-label');
const modelMenu = document.getElementById('model-picker-menu');
const thinkingModeButton = document.getElementById('thinking-mode-button');
const thinkingModeLabel = document.getElementById('thinking-mode-label');
let busy = false;
let modelChoices = [];
let modelPreference = null;
let runtimeModel = null;
let thinkingMode = localStorage.getItem('zeus.webui.thinking_mode') || 'auto'; // 'auto' | 'on' | 'off'

function updateThinkingModeUI() {
    if (!thinkingModeButton || !thinkingModeLabel) return;
    thinkingModeLabel.textContent = `Think: ${thinkingMode.charAt(0).toUpperCase() + thinkingMode.slice(1)}`;
    thinkingModeButton.setAttribute('data-mode', thinkingMode);
    thinkingModeButton.classList.toggle('active', thinkingMode === 'on');
    thinkingModeButton.classList.toggle('disabled-mode', thinkingMode === 'off');
    thinkingModeButton.title = `Thinking mode: ${thinkingMode} (Click to switch: Auto / On / Off)`;
}

if (thinkingModeButton) {
    updateThinkingModeUI();
    thinkingModeButton.addEventListener('click', () => {
        if (thinkingMode === 'auto') thinkingMode = 'on';
        else if (thinkingMode === 'on') thinkingMode = 'off';
        else thinkingMode = 'auto';
        localStorage.setItem('zeus.webui.thinking_mode', thinkingMode);
        updateThinkingModeUI();
    });
}

function getThinkParam() {
    if (thinkingMode === 'on') return true;
    if (thinkingMode === 'off') return false;
    return undefined;
}
const sidebar = initializeSidebar({ api, sessionId: conversationId });

function setEmptyChatLayout(empty) {
    if (empty) {
        welcomeStage.append(composerWrap, chatFooter);
        chatDock.hidden = true;
        chatElement.classList.add('welcome-state');
        return;
    }
    chatDock.append(composerWrap, chatFooter);
    chatDock.hidden = false;
    chatElement.classList.remove('welcome-state');
}

function scrollToLatest() {
    scrollElement.scrollTop = scrollElement.scrollHeight;
}

function addMessage(role, content, { error = false, thinking: thinkingText = '' } = {}) {
    const item = document.createElement('article');
    item.className = `message ${role}${error ? ' error' : ''}`;
    const body = document.createElement('div');
    body.className = 'message-body';
    const contentElement = document.createElement('div');
    contentElement.className = 'message-content';
    if (role === 'assistant' && !error) {
        renderMessageContent(contentElement, content);
        addCodeCopyControls(contentElement);
    } else {
        contentElement.textContent = content;
    }
    const thinking = document.createElement('div');
    thinking.className = 'message-thinking';
    thinking.hidden = true;
    if (role === 'assistant' && thinkingText) {
        const finishedNode = createFinishedThinking(thinkingText);
        if (finishedNode) {
            thinking.append(finishedNode);
            thinking.hidden = false;
        }
    }
    const details = document.createElement('div');
    details.className = 'stream-details';
    body.append(thinking, contentElement, details);
    item.append(body);
    messagesElement.append(item);
    welcomeElement.hidden = true;
    scrollToLatest();
    return { item, thinking, contentElement, details };
}

function setAssistantContent(message, content) {
    message.contentElement.className = 'message-content';
    renderMessageContent(message.contentElement, content);
    addCodeCopyControls(message.contentElement);
    scrollToLatest();
}

async function api(url, options = {}) {
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

function setModelLabel() {
    if (modelPreference) {
        modelLabel.textContent = [modelPreference.provider, modelPreference.model]
            .filter(Boolean).join(' · ');
        return;
    }
    const runtime = runtimeModel
        ? [runtimeModel.provider, runtimeModel.model].filter(Boolean).join(' · ')
        : 'Automatic model';
    modelLabel.textContent = `Automatic · ${runtime}`;
}

async function loadModels() {
    const result = await getModelChoices(conversationId);
    modelChoices = Array.isArray(result.models) ? result.models : [];
    modelPreference = result.preference;
    runtimeModel = result.runtime;
    setModelLabel();
    renderModelMenu();
}

function renderModelMenu() {
    modelMenu.replaceChildren();
    const automatic = document.createElement('button');
    automatic.type = 'button';
    automatic.className = 'model-option';
    automatic.setAttribute('role', 'option');
    automatic.setAttribute('aria-selected', String(!modelPreference));
    const autoCopy = document.createElement('span');
    autoCopy.className = 'model-option-copy';
    const autoName = document.createElement('span');
    autoName.textContent = 'Automatic';
    const autoProvider = document.createElement('span');
    autoProvider.className = 'model-option-provider';
    autoProvider.textContent = runtimeModel
        ? `Use default configuration · ${[runtimeModel.provider, runtimeModel.model].filter(Boolean).join(' · ')}`
        : 'Use the default model configuration';
    autoCopy.append(autoName, autoProvider);
    automatic.append(autoCopy);
    automatic.addEventListener('click', () => chooseModel(null));
    modelMenu.append(automatic);

    const shown = modelChoices.slice(0, 4);
    for (const model of shown) {
        const option = document.createElement('button');
        option.type = 'button';
        option.className = 'model-option';
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', String(
            modelPreference?.provider === model.provider && modelPreference?.model === model.model,
        ));
        const copy = document.createElement('span');
        copy.className = 'model-option-copy';
        const name = document.createElement('span');
        name.textContent = model.model;
        const provider = document.createElement('span');
        provider.className = 'model-option-provider';
        provider.textContent = model.provider;
        copy.append(name, provider);
        option.append(copy);
        option.addEventListener('click', () => chooseModel(model));
        modelMenu.append(option);
    }
    if (modelChoices.length > 4) {
        const more = document.createElement('button');
        more.className = 'model-picker-more';
        more.type = 'button';
        more.disabled = true;
        more.textContent = 'Show more — coming soon';
        modelMenu.append(more);
    }
}

async function chooseModel(model) {
    modelButton.disabled = true;
    try {
        await setModelChoice(conversationId, model);
        modelPreference = model ? { provider: model.provider, model: model.model } : null;
        setModelLabel();
        renderModelMenu();
        modelMenu.hidden = true;
        modelButton.setAttribute('aria-expanded', 'false');
    } catch (error) {
        window.alert(`Could not change the model: ${error.message}`);
    } finally {
        modelButton.disabled = false;
    }
}

function updateSendButton() {
    sendButton.disabled = busy || !input.value.trim();
}

function resizePrompt() {
    input.style.height = 'auto';
    const multiline = input.scrollHeight > 48;
    form.classList.toggle('multiline', multiline);
    input.style.height = `${Math.min(input.scrollHeight, 170)}px`;
}

async function watchAssistantStream(streamId, response) {
    let renderedText = '';
    const loading = createLoadingIndicator();
    response.thinking.hidden = false;
    response.thinking.replaceChildren(loading.element);

    try {
        const result = await watchChatStream({
            streamId,
            onEvent(type, data) {
                if (type === 'ui_control') {
                    if (data.state === 'thinking') loading.setLabel('Thinking…');
                    if (data.state === 'complete' || data.state === 'error') loading.finish();
                } else if (type === 'thinking') {
                    loading.appendThinking(data.text || '');
                    scrollToLatest();
                } else if (type === 'delta') {
                    loading.finish();
                    renderedText += data.text;
                    setAssistantContent(response, renderedText);
                } else if (type === 'streamaddon') {
                    renderStreamDetails(response.details, data);
                } else if (type === 'done') {
                    if (data.message?.thinking) loading.setThinking(data.message.thinking);
                    loading.finish();
                    renderedText = data.message.content;
                    setAssistantContent(response, renderedText);
                }
            },
        });
        if (result.message?.thinking) loading.setThinking(result.message.thinking);
        loading.finish();
        if (!loading.element.isConnected) response.thinking.hidden = true;
        if (!renderedText) setAssistantContent(response, result.message.content);
    } catch (error) {
        loading.remove();
        response.thinking.hidden = true;
        response.item.classList.add('error');
        response.contentElement.className = 'message-content';
        response.contentElement.textContent = error.message;
    }
}

input.addEventListener('input', () => {
    resizePrompt();
    updateSendButton();
});

input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        form.requestSubmit();
    }
});

form.addEventListener('submit', async event => {
    event.preventDefault();
    const messageText = input.value.trim();
    if (!messageText || busy) return;

    busy = true;
    updateSendButton();
    setEmptyChatLayout(false);
    addMessage('user', messageText);
    input.value = '';
    resizePrompt();
    const response = addMessage('assistant', '');

    try {
        const streamId = await startChatStream({
            conversationId,
            message: messageText,
            think: getThinkParam(),
        });
        await watchAssistantStream(streamId, response);
    } catch (error) {
        response.item.classList.add('error');
        response.contentElement.className = 'message-content';
        response.contentElement.textContent = error.message;
    } finally {
        busy = false;
        updateSendButton();
        input.focus();
        sidebar.loadConversations().catch(error => {
            console.error('[WEBUI] Could not refresh conversation list:', error);
        });
    }
});

async function resumeActiveStream() {
    const result = await api(
        `/api/streams/active?conversationId=${encodeURIComponent(conversationId)}`,
    );
    if (!result.streamId) return;

    busy = true;
    updateSendButton();
    setEmptyChatLayout(false);
    await watchAssistantStream(result.streamId, addMessage('assistant', ''));
    busy = false;
    updateSendButton();
    sidebar.loadConversations().catch(error => {
        console.error('[WEBUI] Could not refresh conversation list:', error);
    });
}

modelButton.addEventListener('click', async () => {
    const opening = modelMenu.hidden;
    modelMenu.hidden = !opening;
    modelButton.setAttribute('aria-expanded', String(opening));
    if (opening && modelChoices.length === 0) {
        try {
            await loadModels();
            modelMenu.hidden = false;
            modelButton.setAttribute('aria-expanded', 'true');
        } catch (error) {
            modelMenu.hidden = true;
            modelButton.setAttribute('aria-expanded', 'false');
            window.alert(`Could not load the model list: ${error.message}`);
        }
    }
});

document.addEventListener('click', event => {
    if (!event.target.closest('.model-picker')) {
        modelMenu.hidden = true;
        modelButton.setAttribute('aria-expanded', 'false');
    }
});

Promise.all([
    loadModels(),
    loadSessionHistory({
        api,
        sessionId: conversationId,
        messagesElement,
        welcomeElement,
        loadingElement: historyLoadingElement,
        addMessage,
        renderStreamDetails,
        scrollToLatest,
    }).then(async isEmpty => {
        setEmptyChatLayout(isEmpty);
        await resumeActiveStream();
    }).catch(error => {
        setEmptyChatLayout(false);
        throw error;
    }),
    sidebar.loadConversations(),
]).catch(error => {
    console.error('[WEBUI] Could not initialize chat:', error);
});
