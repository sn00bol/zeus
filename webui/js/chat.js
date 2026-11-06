import { createLoadingIndicator, createFinishedThinking } from './loading.js';
import { getModelChoices, setModelChoice } from './model.js';
import { renderMessageContent } from './render.js';
import {
    addCodeCopyControls,
    removeInlineSourceCitations,
    renderStreamDetails,
} from './streamaddon.js';
import { startChatStream, watchChatStream } from './stream.js';
import { loadSessionHistory, getSessionId } from './session.js';
import { initializeSettings } from './settings.js';
import { initializeSidebar } from './sidebar.js';

let conversationId = getSessionId();
const initialSessionId = conversationId;
let messagesElement = document.getElementById('messages');
const scrollElement = document.getElementById('chat-scroll');
const chatElement = document.querySelector('.chat');
const chatActions = document.getElementById('chat-actions');
const tempChatButton = document.getElementById('temp-chat-button');
const chatMoreButton = document.getElementById('chat-more-button');
const scrollBar = document.getElementById('chat-scrollbar');
const scrollThumb = document.getElementById('chat-scrollbar-thumb');
const welcomeElement = document.getElementById('welcome');
const welcomeStage = document.getElementById('welcome-stage');
const composerWrap = document.getElementById('composer-wrap');
const chatFooter = document.getElementById('chat-footer');
const chatDock = document.getElementById('chat-dock');
const historyLoadingElement = document.getElementById('history-loading');
const form = document.getElementById('chat-form');
const input = document.getElementById('message-input');
const promptInputWrap = document.getElementById('prompt-input-wrap');
const promptScrollBar = document.getElementById('prompt-scrollbar');
const promptScrollThumb = document.getElementById('prompt-scrollbar-thumb');
const sendButton = document.getElementById('send-button');
const toolMenu = document.getElementById('tool-picker-menu');
const selectedToolsElement = document.getElementById('selected-tools');
const modelButton = document.getElementById('model-picker-button');
const modelLabel = document.getElementById('model-picker-label');
const modelMenu = document.getElementById('model-picker-menu');
const thinkingModeButton = document.getElementById('thinking-mode-button');
const thinkingModeLabel = document.getElementById('thinking-mode-label');
const busySessions = new Set();
const activeStreams = new Map();
const sessionViews = new Map([[conversationId, messagesElement]]);
const sessionDrafts = new Map();
const sessionHistoryLoads = new Map();
let switchSequence = 0;
let modelChoices = [];
let modelPreference = null;
let runtimeModel = null;
let settings = null;
let availableTools = [];
let selectedTools = [];
let activeToolOption = 0;
let thinkingMode = localStorage.getItem('zeus.webui.thinking_mode') || 'auto'; // 'auto' | 'on' | 'off'
let scrollHideTimer = null;
let scrollDragging = false;
let scrollDragOffset = 0;
let promptScrollDragging = false;
let promptScrollDragOffset = 0;
let isTempChat = false;
let tempMessagesList = [];
let userPinnedToBottom = true;

const WELCOME_MESSAGES = [
    'Howdy, wanna talk something?',
    'Are you ready to ask something?',
    'What did you want to do today?',
    'Hello! What can I help you with?',
    'Greetings! What\'s on your mind?',
    'Hi there! Ready for some answers?',
    'Hello! Ready to explore something new?',
];

function isNearBottom(threshold = 70) {
    return (scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight) <= threshold;
}

function scrollToLatest(force = false) {
    if (force) {
        userPinnedToBottom = true;
        scrollElement.scrollTop = scrollElement.scrollHeight;
        return;
    }
    if (userPinnedToBottom) {
        scrollElement.scrollTop = scrollElement.scrollHeight;
    }
}

function setTempChatMode(active) {
    isTempChat = Boolean(active);
    document.body.classList.toggle('temp-chat-mode', isTempChat);
    if (tempChatButton) {
        tempChatButton.classList.toggle('active', isTempChat);
        tempChatButton.setAttribute('aria-pressed', String(isTempChat));
        tempChatButton.title = isTempChat
            ? 'Temporary chat is active. Click to exit.'
            : 'Temporary chat';
    }
    if (chatMoreButton) {
        // Temp chat always allows options (e.g., delete), but empty chats typically don't
        chatMoreButton.hidden = !isTempChat && (messagesElement.childElementCount === 0);
    }
}

if (tempChatButton) {
    tempChatButton.addEventListener('click', () => {
        if (!isTempChat) {
            setTempChatMode(true);
            tempChatButton.hidden = true;
            const tempSessionId = `temp-${Date.now()}`;
            conversationId = tempSessionId;
            tempMessagesList = [];
            const tempContainer = createMessageContainer();
            tempContainer.dataset.historyLoaded = 'true';
            sessionViews.set(tempSessionId, tempContainer);
            if (messagesElement !== tempContainer) {
                messagesElement.removeAttribute('id');
                tempContainer.id = 'messages';
                messagesElement.replaceWith(tempContainer);
                messagesElement = tempContainer;
            }
            welcomeElement.hidden = false;
            document.getElementById('welcome-text').textContent = 'Temporary chat';
            document.getElementById('welcome-subtitle').hidden = false;
            setEmptyChatLayout(true);
            input.value = '';
            selectedTools = [];
            renderSelectedTools();
            closeToolMenu();
            resizePrompt();
            updateSendButton();
            input.focus();
        } else {
            setTempChatMode(false);
            tempChatButton.hidden = false;
            document.getElementById('welcome-text').textContent = WELCOME_MESSAGES[Math.floor(Math.random() * WELCOME_MESSAGES.length)];
            document.getElementById('welcome-subtitle').hidden = true;
            sidebar.startNewSession?.();
            window.dispatchEvent(new CustomEvent('zeus:session-change', { detail: getSessionId() }));
        }
    });
}

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

function hasAssistantMessage(container = messagesElement) {
    return container.querySelector('.message.assistant') !== null;
}
const sidebar = initializeSidebar({ api, sessionId: conversationId });
document.getElementById('menubar-brand').addEventListener('click', () => {
    window.location.reload();
});

function setEmptyChatLayout(empty) {
    if (empty) {
        tempChatButton.hidden = false;
        welcomeStage.append(composerWrap, chatFooter);
        chatDock.hidden = true;
        chatElement.classList.add('welcome-state');
        return;
    }
    tempChatButton.hidden = true;
    chatDock.append(composerWrap, chatFooter);
    chatDock.hidden = false;
    chatElement.classList.remove('welcome-state');
}



function updateScrollBar() {
    const maxScroll = scrollElement.scrollHeight - scrollElement.clientHeight;
    const chatBounds = chatElement.getBoundingClientRect();
    const scrollBounds = scrollElement.getBoundingClientRect();
    const menuBounds = chatActions.getBoundingClientRect();
    const top = Math.max(scrollBounds.top, menuBounds.bottom + 8) - chatBounds.top;
    const bottom = scrollBounds.bottom - chatBounds.top;
    const trackHeight = Math.max(0, bottom - top);
    scrollBar.style.top = `${top}px`;
    scrollBar.style.height = `${trackHeight}px`;

    if (maxScroll <= 1 || trackHeight <= 0) {
        scrollBar.classList.remove('visible');
        scrollBar.tabIndex = -1;
        return;
    }

    scrollBar.tabIndex = 0;
    const thumbHeight = Math.min(
        trackHeight,
        Math.max(30, trackHeight * scrollElement.clientHeight / scrollElement.scrollHeight),
    );
    const thumbTravel = trackHeight - thumbHeight;
    const progress = scrollElement.scrollTop / maxScroll;
    scrollThumb.style.height = `${thumbHeight}px`;
    scrollThumb.style.top = `${thumbTravel * progress}px`;
    scrollBar.setAttribute('aria-valuenow', String(Math.round(progress * 1000)));
}

function showScrollBar() {
    if (scrollElement.scrollHeight <= scrollElement.clientHeight + 1) return;
    scrollBar.classList.add('visible');
    if (scrollHideTimer) window.clearTimeout(scrollHideTimer);
    scrollHideTimer = window.setTimeout(() => {
        if (!scrollDragging && !scrollBar.matches(':focus-visible')) {
            scrollBar.classList.remove('visible');
        }
    }, 900);
}

function setScrollFromPointer(clientY, centerThumb = false) {
    const bounds = scrollBar.getBoundingClientRect();
    const maxScroll = scrollElement.scrollHeight - scrollElement.clientHeight;
    const thumbTravel = bounds.height - scrollThumb.offsetHeight;
    if (maxScroll <= 0 || thumbTravel <= 0) return;
    const offset = centerThumb ? scrollThumb.offsetHeight / 2 : scrollDragOffset;
    const thumbTop = Math.max(0, Math.min(
        thumbTravel,
        clientY - bounds.top - offset,
    ));
    scrollElement.scrollTop = thumbTop / thumbTravel * maxScroll;
}

function updatePromptScrollBar() {
    const maxScroll = input.scrollHeight - input.clientHeight;
    const trackHeight = promptScrollBar.clientHeight;
    if (maxScroll <= 1 || trackHeight <= 0) {
        promptInputWrap.classList.remove('is-scrollable');
        promptScrollBar.tabIndex = -1;
        return;
    }

    promptInputWrap.classList.add('is-scrollable');
    promptScrollBar.tabIndex = 0;
    const thumbHeight = Math.min(
        trackHeight,
        Math.max(24, trackHeight * input.clientHeight / input.scrollHeight),
    );
    const thumbTravel = trackHeight - thumbHeight;
    const progress = input.scrollTop / maxScroll;
    promptScrollThumb.style.height = `${thumbHeight}px`;
    promptScrollThumb.style.top = `${thumbTravel * progress}px`;
    promptScrollBar.setAttribute('aria-valuenow', String(Math.round(progress * 1000)));
}

function setPromptScrollFromPointer(clientY, centerThumb = false) {
    const bounds = promptScrollBar.getBoundingClientRect();
    const maxScroll = input.scrollHeight - input.clientHeight;
    const thumbTravel = bounds.height - promptScrollThumb.offsetHeight;
    if (maxScroll <= 0 || thumbTravel <= 0) return;
    const offset = centerThumb ? promptScrollThumb.offsetHeight / 2 : promptScrollDragOffset;
    const thumbTop = Math.max(0, Math.min(
        thumbTravel,
        clientY - bounds.top - offset,
    ));
    input.scrollTop = thumbTop / thumbTravel * maxScroll;
}

promptScrollBar.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    promptScrollDragging = true;
    promptScrollBar.setPointerCapture(event.pointerId);
    const thumbBounds = promptScrollThumb.getBoundingClientRect();
    const onThumb = event.target === promptScrollThumb;
    promptScrollDragOffset = onThumb ? event.clientY - thumbBounds.top : promptScrollThumb.offsetHeight / 2;
    if (!onThumb) setPromptScrollFromPointer(event.clientY, true);
});
promptScrollBar.addEventListener('pointermove', event => {
    if (promptScrollDragging) setPromptScrollFromPointer(event.clientY);
});
const stopPromptScrollDrag = () => {
    promptScrollDragging = false;
};
promptScrollBar.addEventListener('pointerup', stopPromptScrollDrag);
promptScrollBar.addEventListener('pointercancel', stopPromptScrollDrag);
promptScrollBar.addEventListener('keydown', event => {
    const page = input.clientHeight * 0.85;
    if (event.key === 'ArrowUp') input.scrollTop -= 40;
    else if (event.key === 'ArrowDown') input.scrollTop += 40;
    else if (event.key === 'PageUp') input.scrollTop -= page;
    else if (event.key === 'PageDown') input.scrollTop += page;
    else if (event.key === 'Home') input.scrollTop = 0;
    else if (event.key === 'End') input.scrollTop = input.scrollHeight;
    else return;
    event.preventDefault();
});
input.addEventListener('scroll', updatePromptScrollBar, { passive: true });
window.addEventListener('resize', updatePromptScrollBar);
const promptResizeObserver = new ResizeObserver(updatePromptScrollBar);
promptResizeObserver.observe(input);

scrollElement.addEventListener('wheel', event => {
    if (event.deltaY < 0) {
        userPinnedToBottom = false;
    } else if (event.deltaY > 0 && isNearBottom(50)) {
        userPinnedToBottom = true;
    }
}, { passive: true });

let touchStartY = 0;
scrollElement.addEventListener('touchstart', event => {
    if (event.touches.length) touchStartY = event.touches[0].clientY;
}, { passive: true });
scrollElement.addEventListener('touchmove', event => {
    if (event.touches.length) {
        const delta = event.touches[0].clientY - touchStartY;
        if (delta > 6) {
            userPinnedToBottom = false;
        } else if (isNearBottom(50)) {
            userPinnedToBottom = true;
        }
    }
}, { passive: true });

scrollElement.addEventListener('scroll', () => {
    if (isNearBottom(60)) {
        userPinnedToBottom = true;
    }
    updateScrollBar();
    showScrollBar();
}, { passive: true });
scrollBar.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    userPinnedToBottom = false;
    scrollDragging = true;
    scrollBar.setPointerCapture(event.pointerId);
    const thumbBounds = scrollThumb.getBoundingClientRect();
    const onThumb = event.target === scrollThumb;
    scrollDragOffset = onThumb ? event.clientY - thumbBounds.top : scrollThumb.offsetHeight / 2;
    if (!onThumb) setScrollFromPointer(event.clientY, true);
    showScrollBar();
});
scrollBar.addEventListener('pointermove', event => {
    if (scrollDragging) setScrollFromPointer(event.clientY);
});
const stopScrollDrag = () => {
    if (!scrollDragging) return;
    scrollDragging = false;
    showScrollBar();
};
scrollBar.addEventListener('pointerup', stopScrollDrag);
scrollBar.addEventListener('pointercancel', stopScrollDrag);
scrollBar.addEventListener('keydown', event => {
    const page = scrollElement.clientHeight * 0.85;
    if (event.key === 'ArrowUp') scrollElement.scrollTop -= 40;
    else if (event.key === 'ArrowDown') scrollElement.scrollTop += 40;
    else if (event.key === 'PageUp') scrollElement.scrollTop -= page;
    else if (event.key === 'PageDown') scrollElement.scrollTop += page;
    else if (event.key === 'Home') scrollElement.scrollTop = 0;
    else if (event.key === 'End') scrollElement.scrollTop = scrollElement.scrollHeight;
    else return;
    event.preventDefault();
    showScrollBar();
});
window.addEventListener('resize', updateScrollBar);
const scrollResizeObserver = new ResizeObserver(updateScrollBar);
scrollResizeObserver.observe(scrollElement);
scrollResizeObserver.observe(document.querySelector('.chat-content'));

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
    container = messagesElement,
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
                ? removeInlineSourceCitations(removeLeadingSourceSection(content), sources)
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
    container.append(item);
    if (container === messagesElement) {
        welcomeElement.hidden = true;
        scrollToLatest(true);
    }
    return { item, thinking, contentElement, details };
}

function setAssistantContent(message, content, sources = []) {
    message.contentElement.className = 'message-content';
    renderMessageContent(
        message.contentElement,
        Array.isArray(sources) && sources.length
            ? removeInlineSourceCitations(removeLeadingSourceSection(content), sources)
            : content,
    );
    addCodeCopyControls(message.contentElement);
    if (messagesElement.contains(message.item)) scrollToLatest(false);
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

async function loadModels(sessionId = conversationId) {
    const result = await getModelChoices(sessionId);
    if (sessionId !== conversationId) return;
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
        provider.textContent = model.provider_name || model.provider;
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

async function chooseModel(model, { showError = true } = {}) {
    modelButton.disabled = true;
    try {
        await setModelChoice(conversationId, model);
        modelPreference = model ? { provider: model.provider, model: model.model } : null;
        setModelLabel();
        renderModelMenu();
        modelMenu.hidden = true;
        modelButton.setAttribute('aria-expanded', 'false');
        return true;
    } catch (error) {
        if (showError) window.alert(`Could not change the model: ${error.message}`);
        if (!showError) throw error;
        return false;
    } finally {
        modelButton.disabled = false;
    }
}

settings = initializeSettings({
    getConversationId: () => conversationId,
    loadModels,
    onSearchSettingChange: enabled => {
        if (!enabled) selectedTools = selectedTools.filter(name => name !== 'search');
        renderSelectedTools();
        renderToolMenu();
    },
});

function updateSendButton() {
    const hasInput = Boolean(input.value.trim());
    form.classList.toggle('has-input', hasInput);
    sendButton.disabled = busySessions.has(conversationId)
        || messagesElement.dataset.historyLoaded !== 'true'
        || !hasInput;
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
        (tool.name !== 'search' || settings?.isSearchEnabled() !== false)
        && (
            tool.name.includes(mention.query)
            || tool.label.toLowerCase().includes(mention.query)
            || tool.description.toLowerCase().includes(mention.query)
        )
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
    updatePromptScrollBar();
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
                    if (messagesElement.contains(response.item)) scrollToLatest(false);
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
        if (isTempChat) {
            tempMessagesList.push({
                role: 'assistant',
                content: result.message?.content || renderedText,
            });
        }
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
    if (!messageText || busySessions.has(conversationId)
        || messagesElement.dataset.historyLoaded !== 'true') return;
    const sessionId = conversationId;
    const messageContainer = messagesElement;
    const tools = [...selectedTools];

    busySessions.add(sessionId);
    messageContainer.dataset.historyLoaded = 'true';
    updateSendButton();
    setEmptyChatLayout(false);
    userPinnedToBottom = true;
    addMessage('user', messageText);
    if (isTempChat) {
        tempMessagesList.push({ role: 'user', content: messageText });
    }
    chatActions.hidden = false;
    if (chatMoreButton) chatMoreButton.hidden = isTempChat;
    input.value = '';
    selectedTools = [];
    renderSelectedTools();
    closeToolMenu();
    resizePrompt();
    const response = addMessage('assistant', '', {}, messageContainer);
    // Show the more button after assistant message is added
    if (chatMoreButton) chatMoreButton.hidden = false;

    try {
        const streamId = await startChatStream({
            conversationId: sessionId,
            message: messageText,
            think: getThinkParam(),
            tools,
            isTemporary: isTempChat,
            messages: isTempChat ? tempMessagesList : [],
        });
        activeStreams.set(sessionId, streamId);
        if (!isTempChat) {
            sidebar.loadConversations().catch(error => {
                console.error('[WEBUI] Could not refresh conversation list:', error);
            });
        }
        await watchAssistantStream(streamId, response);
    } catch (error) {
        response.item.classList.add('error');
        response.contentElement.className = 'message-content';
        response.contentElement.textContent = error.message;
    } finally {
        busySessions.delete(sessionId);
        activeStreams.delete(sessionId);
        if (sessionId === conversationId) {
            updateSendButton();
            input.focus();
        }
        if (!isTempChat) {
            sidebar.loadConversations().catch(error => {
                console.error('[WEBUI] Could not refresh conversation list:', error);
            });
        }
    }
});

async function resumeActiveStream(sessionId = conversationId) {
    if (activeStreams.has(sessionId)) return;
    const result = await api(
        `/api/streams/active?conversationId=${encodeURIComponent(sessionId)}`,
    );
    if (!result.streamId) return;

    const messageContainer = sessionViews.get(sessionId);
    if (!messageContainer) return;
    activeStreams.set(sessionId, result.streamId);
    busySessions.add(sessionId);
    if (sessionId === conversationId) {
        updateSendButton();
        setEmptyChatLayout(false);
        chatActions.hidden = false;
        if (chatMoreButton) chatMoreButton.hidden = isTempChat;
    }
    try {
        await watchAssistantStream(
            result.streamId,
            addMessage('assistant', '', {}, messageContainer),
        );
    } finally {
        activeStreams.delete(sessionId);
        busySessions.delete(sessionId);
        if (sessionId === conversationId) updateSendButton();
        sidebar.loadConversations().catch(error => {
            console.error('[WEBUI] Could not refresh conversation list:', error);
        });
    }
}

function createMessageContainer() {
    const container = document.createElement('div');
    container.className = 'messages';
    return container;
}

function loadHistory(sessionId, messageContainer) {
    if (messageContainer.dataset.historyLoaded === 'true') {
        return Promise.resolve(messageContainer.childElementCount === 0);
    }
    if (sessionHistoryLoads.has(sessionId)) return sessionHistoryLoads.get(sessionId);

    const loading = loadSessionHistory({
        api,
        sessionId,
        messagesElement: messageContainer,
        welcomeElement,
        loadingElement: historyLoadingElement,
        addMessage,
        renderStreamDetails,
        scrollToLatest,
        messageContainer,
    }).then(isEmpty => {
        messageContainer.dataset.historyLoaded = 'true';
        return isEmpty;
    });
    sessionHistoryLoads.set(sessionId, loading);
    loading.finally(() => sessionHistoryLoads.delete(sessionId)).catch(() => {});
    return loading;
}

async function switchSession(sessionId) {
    if (isTempChat) setTempChatMode(false);
    const sequence = ++switchSequence;
    sessionDrafts.set(conversationId, input.value);
    conversationId = sessionId;
    sidebar.setSessionId(sessionId);
    let nextMessages = sessionViews.get(sessionId);
    if (!nextMessages) {
        nextMessages = createMessageContainer();
        sessionViews.set(sessionId, nextMessages);
    }
    if (nextMessages !== messagesElement) {
        messagesElement.removeAttribute('id');
        nextMessages.id = 'messages';
        messagesElement.replaceWith(nextMessages);
        messagesElement = nextMessages;
    }
    const cachedIsEmpty = messagesElement.childElementCount === 0;
    welcomeElement.hidden = !cachedIsEmpty;
    chatActions.hidden = false;
    if (chatMoreButton) chatMoreButton.hidden = isTempChat || !hasAssistantMessage(nextMessages);
    setEmptyChatLayout(cachedIsEmpty);

    // Reset welcome text to random message when switching to empty session
    if (cachedIsEmpty && !isTempChat) {
        document.getElementById('welcome-text').textContent = WELCOME_MESSAGES[Math.floor(Math.random() * WELCOME_MESSAGES.length)];
        document.getElementById('welcome-subtitle').hidden = true;
    }

    input.value = sessionDrafts.get(sessionId) || '';
    selectedTools = [];
    renderSelectedTools();
    closeToolMenu();
    resizePrompt();
    updateSendButton();
    historyLoadingElement.hidden = true;

    let isEmpty = messagesElement.childElementCount === 0;
    if (messagesElement.dataset.historyLoaded !== 'true') {
        historyLoadingElement.hidden = false;
        historyLoadingElement.textContent = 'Loading conversation…';
        try {
            isEmpty = await loadHistory(sessionId, messagesElement);
        } catch (error) {
            console.error('[WEBUI] Could not load conversation history:', error);
            historyLoadingElement.textContent = 'Could not load conversation history.';
            historyLoadingElement.hidden = false;
        }
    }
    if (sequence !== switchSequence || sessionId !== conversationId) return;

    isEmpty = messagesElement.childElementCount === 0;
    welcomeElement.hidden = !isEmpty;
    chatActions.hidden = false;
    if (chatMoreButton) chatMoreButton.hidden = isTempChat || !hasAssistantMessage(messagesElement);
    setEmptyChatLayout(isEmpty);
    historyLoadingElement.hidden = true;
    updateSendButton();
    await loadModels(sessionId).catch(error => {
        console.error('[WEBUI] Could not load the model for this conversation:', error);
    });
    if (sequence !== switchSequence || sessionId !== conversationId) return;
    resumeActiveStream(sessionId).catch(error => {
        console.error('[WEBUI] Could not resume the conversation stream:', error);
    });
    sidebar.loadConversations().catch(error => {
        console.error('[WEBUI] Could not refresh conversation list:', error);
    });
    input.focus();
}

window.addEventListener('zeus:session-change', event => {
    switchSession(event.detail);
});

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
    loadHistory(conversationId, messagesElement).then(async isEmpty => {
        if (conversationId !== initialSessionId) return;
        updateSendButton();
        setEmptyChatLayout(isEmpty);
        chatActions.hidden = false;
        if (chatMoreButton) chatMoreButton.hidden = isTempChat || !hasAssistantMessage(messagesElement);
        if (isEmpty && !isTempChat) {
            document.getElementById('welcome-text').textContent = WELCOME_MESSAGES[Math.floor(Math.random() * WELCOME_MESSAGES.length)];
        }
        await resumeActiveStream();
    }).catch(error => {
        if (conversationId !== initialSessionId) return;
        setEmptyChatLayout(false);
        throw error;
    }),
    sidebar.loadConversations(),
]).catch(error => {
    console.error('[WEBUI] Could not initialize chat:', error);
});
