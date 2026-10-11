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
const toolMenu = document.getElementById('tool-picker-menu');
const selectedToolsElement = document.getElementById('selected-tools');
const modelButton = document.getElementById('model-picker-button');
const modelLabel = document.getElementById('model-picker-label');
const modelMenu = document.getElementById('model-picker-menu');
const thinkingModeButton = document.getElementById('thinking-mode-button');
const thinkingModeLabel = document.getElementById('thinking-mode-label');
let busy = false;
let modelChoices = [];
let modelPreference = null;
let runtimeModel = null;
let availableTools = [];
let selectedTools = [];
let activeToolOption = 0;
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
document.getElementById('menubar-brand').addEventListener('click', () => {
    window.location.reload();
});

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

function removeLeadingSourceSection(content) {
    const lines = String(content).replace(/\r\n?/g, '\n').split('\n');
    let headingIndex = 0;
    while (headingIndex < lines.length && !lines[headingIndex].trim()) headingIndex += 1;

    const heading = lines[headingIndex]?.trim()
        .replace(/^#{1,6}\s*/, '')
        .replace(/^\*\*(.*)\*\*$/, '$1')
        .replace(/:$/, '')
        .trim();
    if (!/^(sources?|references?|bibliography|nguồn(?:\s+tham\s+khảo)?)$/i.test(heading || '')) {
        return content;
    }

    let contentIndex = headingIndex + 1;
    while (contentIndex < lines.length) {
        const line = lines[contentIndex].trim();
        if (
            !line
            || /^(?:[-*+]\s+|\d+[.)]\s+|https?:\/\/)/i.test(line)
            || /https?:\/\/\S+/i.test(line)
        ) {
            contentIndex += 1;
            continue;
        }
        break;
    }
    return lines.slice(contentIndex).join('\n').trimStart();
}

function addMessage(
    role,
    content,
    { error = false, thinking: thinkingText = '', sources = [] } = {},
) {
    const item = document.createElement('article');
    item.className = `message ${role}${error ? ' error' : ''}`;
    const body = document.createElement('div');
    body.className = 'message-body';
    const contentElement = document.createElement('div');
    contentElement.className = 'message-content';
    if (role === 'assistant' && !error) {
        renderMessageContent(
            contentElement,
            Array.isArray(sources) && sources.length
                ? removeLeadingSourceSection(content)
                : content,
        );
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

function setAssistantContent(message, content, sources = []) {
    message.contentElement.className = 'message-content';
    renderMessageContent(
        message.contentElement,
        Array.isArray(sources) && sources.length
            ? removeLeadingSourceSection(content)
            : content,
    );
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
    modelLabel.textContent = 'Automatic';
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
    autoProvider.textContent = 'Use the default model configuration';
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

function getToolMention() {
    const cursor = input.selectionStart;
    const beforeCursor = input.value.slice(0, cursor);
    const match = beforeCursor.match(/@([a-zA-Z0-9_-]*)$/);
    if (!match) return null;
    return {
        start: cursor - match[0].length,
        query: match[1].toLowerCase(),
    };
}

function visibleTools() {
    const mention = getToolMention();
    if (!mention) return [];
    return availableTools.filter(tool => (
        tool.name.includes(mention.query)
        || tool.label.toLowerCase().includes(mention.query)
        || tool.description.toLowerCase().includes(mention.query)
    ));
}

function closeToolMenu() {
    toolMenu.hidden = true;
    toolMenu.replaceChildren();
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
}

function renderToolMenu() {
    const tools = visibleTools();
    if (!tools.length) {
        closeToolMenu();
        return;
    }

    toolMenu.replaceChildren();
    activeToolOption = Math.min(activeToolOption, tools.length - 1);
    for (const [index, tool] of tools.entries()) {
        const option = document.createElement('button');
        option.type = 'button';
        option.className = 'tool-option';
        option.id = `tool-option-${tool.name}`;
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', String(index === activeToolOption));
        option.addEventListener('mousedown', event => event.preventDefault());
        const label = document.createElement('span');
        label.className = 'tool-option-label';
        label.textContent = `@${tool.name}`;
        const description = document.createElement('span');
        description.className = 'tool-option-description';
        description.textContent = tool.description;
        option.append(label, description);
        option.addEventListener('click', () => selectTool(tool));
        toolMenu.append(option);
    }
    toolMenu.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-activedescendant', `tool-option-${tools[activeToolOption].name}`);
}

function renderSelectedTools() {
    selectedToolsElement.replaceChildren();
    for (const toolName of selectedTools) {
        const tool = availableTools.find(item => item.name === toolName);
        if (!tool) continue;
        const chip = document.createElement('span');
        chip.className = 'selected-tool';
        const label = document.createElement('span');
        label.textContent = `@${tool.label}`;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'selected-tool-remove';
        remove.setAttribute('aria-label', `Remove ${tool.label} tool`);
        remove.textContent = '×';
        remove.addEventListener('click', () => {
            selectedTools = selectedTools.filter(name => name !== toolName);
            renderSelectedTools();
            input.focus();
        });
        chip.append(label, remove);
        selectedToolsElement.append(chip);
    }
    const hasTools = selectedTools.length > 0;
    selectedToolsElement.hidden = !hasTools;
    form.classList.toggle('has-tools', hasTools);
}

function selectTool(tool) {
    const mention = getToolMention();
    if (!mention) return;
    if (!selectedTools.includes(tool.name)) selectedTools.push(tool.name);
    const cursor = input.selectionStart;
    input.value = `${input.value.slice(0, mention.start)}${input.value.slice(cursor)}`;
    input.setSelectionRange(mention.start, mention.start);
    closeToolMenu();
    renderSelectedTools();
    resizePrompt();
    updateSendButton();
    input.focus();
}

async function loadTools() {
    const result = await api('/api/tools');
    availableTools = Array.isArray(result.tools) ? result.tools : [];
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

    let renderTimer = null;
    const scheduleRender = () => {
        if (renderTimer) return;
        renderTimer = requestAnimationFrame(() => {
            renderTimer = null;
            setAssistantContent(response, renderedText);
        });
    };
    const flushRender = (finalText, sources = []) => {
        if (renderTimer) {
            cancelAnimationFrame(renderTimer);
            renderTimer = null;
        }
        if (typeof finalText === 'string') renderedText = finalText;
        setAssistantContent(response, renderedText, sources);
    };

    try {
        const result = await watchChatStream({
            onEvent(type, data) {
                if (type === 'ui_control') {
                    if (data.state === 'thinking') loading.setLabel('Thinking…');
                    if (data.state === 'complete' || data.state === 'error') loading.finish();
                } else if (type === 'thinking') {
                    loading.appendThinking(data.text || '');
                    scrollToLatest();
                } else if (type === 'delta') {
                    loading.setGenerating();
                    renderedText += data.text;
                    scheduleRender();
                } else if (type === 'streamaddon') {
                    renderStreamDetails(response.details, data);
                } else if (type === 'done') {
                    if (data.message?.thinking) loading.setThinking(data.message.thinking);
                    loading.finish();
                    flushRender(data.message.content, data.message.sources);
                }
            },
            streamId,
        });
        if (result.message?.thinking) loading.setThinking(result.message.thinking);
        loading.finish();
        flushRender(
            result.message?.content || renderedText,
            result.message?.sources,
        );
        if (!loading.element.isConnected) response.thinking.hidden = true;
    } catch (error) {
        if (renderTimer) cancelAnimationFrame(renderTimer);
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
    activeToolOption = 0;
    renderToolMenu();
});

input.addEventListener('keydown', event => {
    const tools = visibleTools();
    if (!toolMenu.hidden && tools.length) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            activeToolOption = (
                activeToolOption + (event.key === 'ArrowDown' ? 1 : tools.length - 1)
            ) % tools.length;
            renderToolMenu();
            return;
        }
        if (event.key === 'Escape') {
            closeToolMenu();
            return;
        }
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            selectTool(tools[activeToolOption]);
            return;
        }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        form.requestSubmit();
    }
});

form.addEventListener('submit', async event => {
    event.preventDefault();
    const messageText = input.value.trim();
    if (!messageText || busy) return;
    const tools = [...selectedTools];

    busy = true;
    updateSendButton();
    setEmptyChatLayout(false);
    addMessage('user', messageText);
    input.value = '';
    selectedTools = [];
    renderSelectedTools();
    closeToolMenu();
    resizePrompt();
    const response = addMessage('assistant', '');

    try {
        const streamId = await startChatStream({
            conversationId,
            message: messageText,
            think: getThinkParam(),
            tools,
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
    loadTools(),
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
