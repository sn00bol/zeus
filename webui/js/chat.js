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
import { initializeScrollbar } from './scrollbar.js';

let conversationId = getSessionId();
const initialSessionId = conversationId;
let messagesElement = document.getElementById('messages');
const scrollElement = document.getElementById('chat-scroll');
const chatElement = document.querySelector('.chat');
const chatActions = document.getElementById('chat-actions');
const tempChatButton = document.getElementById('temp-chat-button');
const chatTitleButton = document.getElementById('chat-title-button');
const stopButton = document.getElementById('stop-button');
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
const promptAttachmentsElement = document.getElementById('prompt-attachments');
const composerActions = document.querySelector('.composer-actions');
const addButton = document.getElementById('prompt-add-button');
const addMenu = document.getElementById('prompt-add-menu');
const addFilesOption = document.getElementById('add-files-option');
const searchOption = document.getElementById('add-search-option');
const filesInput = document.getElementById('prompt-files-input');
const imageViewer = document.getElementById('attachment-image-viewer');
const imageStage = document.getElementById('attachment-image-stage');
const imagePreview = document.getElementById('attachment-image-full');
const imageVerticalScrollbar = document.getElementById('attachment-image-scrollbar-vertical');
const imageHorizontalScrollbar = document.getElementById('attachment-image-scrollbar-horizontal');
const imagePreviewTitle = document.getElementById('attachment-image-title');
const imageZoomButton = document.getElementById('attachment-image-zoom');
const imageZoomMenu = document.getElementById('attachment-image-zoom-menu');
const imageDownloadButton = document.getElementById('attachment-image-download');
const imageShareButton = document.getElementById('attachment-image-share');
const imageCloseButton = document.getElementById('attachment-image-close');
const filePreview = document.getElementById('attachment-file-preview');
const filePreviewTitle = document.getElementById('attachment-file-title');
const fileCodeView = document.getElementById('attachment-code-view');
const fileVerticalScrollbar = document.getElementById('attachment-file-scrollbar-vertical');
const fileHorizontalScrollbar = document.getElementById('attachment-file-scrollbar-horizontal');
const fileCopyButton = document.getElementById('attachment-file-copy');
const fileDownloadButton = document.getElementById('attachment-file-download');
const fileShareButton = document.getElementById('attachment-file-share');
const fileCloseButton = document.getElementById('attachment-file-close');
const fileResizeHandle = document.getElementById('attachment-file-resize-handle');
const modelButton = document.getElementById('model-picker-button');
const modelLabel = document.getElementById('model-picker-label');
const modelMenu = document.getElementById('model-picker-menu');
const thinkingModeButton = document.getElementById('thinking-mode-button');
const thinkingModeLabel = document.getElementById('thinking-mode-label');
const busySessions = new Set();
const generatingSessions = new Set();
const activeStreams = new Map();
const sessionViews = new Map([[conversationId, messagesElement]]);
const sessionDrafts = new Map();
const sessionDraftAttachments = new Map();
const sessionHistoryLoads = new Map();
let switchSequence = 0;
let modelChoices = [];
let modelPreference = null;
let runtimeModel = null;
let settings = null;
let availableTools = [];
let selectedTools = [];
let selectedAttachments = [];
let activeAttachmentPreview = null;
let imageZoomPercent = 100;
let imagePan = null;
let codeScrollbarSequence = 0;
let filePreviewCloseTimer = null;
let filePreviewResize = null;
const actionFeedbackTimers = new WeakMap();
const codeScrollbarInstances = new WeakMap();
let activeToolOption = 0;
let thinkingMode = localStorage.getItem('zeus.webui.thinking_mode') || 'auto'; // 'auto' | 'on' | 'off'
let promptScrollDragging = false;
let promptScrollDragOffset = 0;
let isTempChat = false;
let tempMessagesList = [];
let userPinnedToBottom = true;
let lastChatScrollTop = scrollElement.scrollTop;
const tempThemeColors = {
    accent: '#ffffff',
    sidebar: '#000000',
    background: '#000000',
    foreground: '#ededed',
};

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
    document.body.dataset.themeMode = isTempChat
        ? 'dark'
        : document.documentElement.dataset.themeMode;
    for (const name of Object.keys(tempThemeColors)) {
        document.body.style.setProperty(
            `--user-${name}`,
            isTempChat
                ? tempThemeColors[name]
                : document.documentElement.style.getPropertyValue(`--user-${name}`),
        );
    }
    if (tempChatButton) {
        tempChatButton.classList.toggle('active', isTempChat);
        tempChatButton.setAttribute('aria-pressed', String(isTempChat));
        tempChatButton.title = isTempChat
            ? 'Temporary chat is active. Click to exit.'
            : 'Temporary chat';
    }
    if (chatTitleButton) {
        chatTitleButton.hidden = isTempChat || messagesElement.childElementCount === 0;
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
            if (chatTitleButton) chatTitleButton.hidden = true;
            welcomeElement.hidden = false;
            document.getElementById('welcome-text').textContent = 'Temporary chat';
            document.getElementById('welcome-subtitle').hidden = false;
            setEmptyChatLayout(true);
            input.value = '';
            closeAttachmentPreview({ restoreFocus: false });
            selectedAttachments = [];
            renderSelectedAttachments();
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
        requestAnimationFrame(resizePrompt);
        return;
    }
    tempChatButton.hidden = !isTempChat;
    chatDock.append(composerWrap, chatFooter);
    chatDock.hidden = false;
    chatElement.classList.remove('welcome-state');
    requestAnimationFrame(resizePrompt);
}



initializeScrollbar({
    scrollElement,
    scrollbar: scrollBar,
    thumb: scrollThumb,
    layoutTrack() {
        const chatBounds = chatElement.getBoundingClientRect();
        const scrollBounds = scrollElement.getBoundingClientRect();
        const menuBounds = chatActions.getBoundingClientRect();
        const top = Math.max(scrollBounds.top, menuBounds.bottom + 8) - chatBounds.top;
        const bottom = scrollBounds.bottom - chatBounds.top;
        const trackHeight = Math.max(0, bottom - top);
        scrollBar.style.top = `${top}px`;
        scrollBar.style.height = `${trackHeight}px`;
    },
    onScroll() {
        const scrollTop = scrollElement.scrollTop;
        if (scrollTop > lastChatScrollTop + 1 && isNearBottom(60)) {
            userPinnedToBottom = true;
        }
        lastChatScrollTop = scrollTop;
    },
    onPointerDown() {
        userPinnedToBottom = false;
    },
    observe: [document.querySelector('.chat-content')],
});

function layoutImageScrollbar(scrollbar) {
    const viewerBounds = imageViewer.getBoundingClientRect();
    const stageBounds = imageStage.getBoundingClientRect();
    scrollbar.style.top = `${stageBounds.top - viewerBounds.top}px`;
    scrollbar.style.left = `${stageBounds.left - viewerBounds.left}px`;
    scrollbar.style.width = `${stageBounds.width}px`;
    scrollbar.style.height = `${stageBounds.height}px`;
}

const imageVerticalScroll = initializeScrollbar({
    scrollElement: imageStage,
    scrollbar: imageVerticalScrollbar,
    thumb: imageVerticalScrollbar.querySelector('.chat-scrollbar-thumb'),
    layoutTrack: () => layoutImageScrollbar(imageVerticalScrollbar),
    onScrollableChange: () => {
        imageStage.classList.toggle(
            'is-draggable',
            imageStage.scrollWidth > imageStage.clientWidth + 1
                || imageStage.scrollHeight > imageStage.clientHeight + 1,
        );
    },
    observe: [imagePreview],
});
const imageHorizontalScroll = initializeScrollbar({
    scrollElement: imageStage,
    scrollbar: imageHorizontalScrollbar,
    thumb: imageHorizontalScrollbar.querySelector('.chat-scrollbar-thumb'),
    axis: 'horizontal',
    layoutTrack: () => layoutImageScrollbar(imageHorizontalScrollbar),
    onScrollableChange: () => {
        imageStage.classList.toggle(
            'is-draggable',
            imageStage.scrollWidth > imageStage.clientWidth + 1
                || imageStage.scrollHeight > imageStage.clientHeight + 1,
        );
    },
    observe: [imagePreview],
});

function layoutFileScrollbar(scrollbar) {
    const previewBounds = filePreview.getBoundingClientRect();
    const codeBounds = fileCodeView.getBoundingClientRect();
    scrollbar.style.top = `${codeBounds.top - previewBounds.top}px`;
    scrollbar.style.left = `${codeBounds.left - previewBounds.left}px`;
    scrollbar.style.width = `${codeBounds.width}px`;
    scrollbar.style.height = `${codeBounds.height}px`;
}

const fileVerticalScroll = initializeScrollbar({
    scrollElement: fileCodeView,
    scrollbar: fileVerticalScrollbar,
    thumb: fileVerticalScrollbar.querySelector('.chat-scrollbar-thumb'),
    layoutTrack: () => layoutFileScrollbar(fileVerticalScrollbar),
    onScrollableChange: isScrollable => {
        fileCodeView.classList.toggle('has-vertical-scrollbar', isScrollable);
    },
    observe: [filePreview],
});
const fileHorizontalScroll = initializeScrollbar({
    scrollElement: fileCodeView,
    scrollbar: fileHorizontalScrollbar,
    thumb: fileHorizontalScrollbar.querySelector('.chat-scrollbar-thumb'),
    axis: 'horizontal',
    layoutTrack: () => layoutFileScrollbar(fileHorizontalScrollbar),
    onScrollableChange: isScrollable => {
        fileCodeView.classList.toggle('has-horizontal-scrollbar', isScrollable);
    },
    observe: [filePreview],
});

function destroyCodeScrollbars(container) {
    for (const scrollbar of codeScrollbarInstances.get(container) || []) {
        scrollbar.destroy();
    }
    codeScrollbarInstances.delete(container);
    container.querySelectorAll('.code-horizontal-scrollbar').forEach(scrollbar => scrollbar.remove());
}

function initializeCodeScrollbars(container) {
    destroyCodeScrollbars(container);
    const instances = [];
    for (const code of container.querySelectorAll('pre code')) {
        const pre = code.closest('pre');
        if (!pre) continue;
        code.classList.add('has-custom-scrollbar');
        const scrollbar = document.createElement('div');
        scrollbar.className = 'chat-scrollbar code-horizontal-scrollbar';
        code.id ||= `message-code-${++codeScrollbarSequence}`;
        scrollbar.setAttribute('role', 'scrollbar');
        scrollbar.setAttribute('aria-label', 'Code horizontal scroll position');
        scrollbar.setAttribute('aria-controls', code.id);
        scrollbar.setAttribute('aria-orientation', 'horizontal');
        scrollbar.setAttribute('aria-valuemin', '0');
        scrollbar.setAttribute('aria-valuemax', '1000');
        scrollbar.setAttribute('aria-valuenow', '0');
        scrollbar.tabIndex = -1;
        const thumb = document.createElement('div');
        thumb.className = 'chat-scrollbar-thumb';
        scrollbar.append(thumb);
        pre.append(scrollbar);
        instances.push(initializeScrollbar({
            scrollElement: code,
            scrollbar,
            thumb,
            axis: 'horizontal',
            observe: [pre],
        }));
    }
    codeScrollbarInstances.set(container, instances);
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
    {
        error = false,
        thinking: thinkingText = '',
        sources = [],
        tools = [],
        attachments = [],
    } = {},
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
        initializeCodeScrollbars(contentElement);
    } else {
        contentElement.textContent = content;
    }
    if (role === 'user' && Array.isArray(tools) && tools.includes('search')) {
        const searchIndicator = document.createElement('span');
        searchIndicator.className = 'message-search-tool';
        const icon = document.createElement('img');
        icon.src = '/icon/search.png';
        icon.alt = '';
        icon.width = 14;
        icon.height = 14;
        const label = document.createElement('span');
        label.textContent = 'Search on the Internet';
        searchIndicator.append(icon, label);
        contentElement.insertBefore(searchIndicator, contentElement.firstChild);
        contentElement.insertBefore(
            document.createTextNode(' '),
            searchIndicator.nextSibling,
        );
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
    if (role === 'user' && attachments.length) {
        const attachmentList = document.createElement('div');
        attachmentList.className = 'message-attachments';
        renderAttachments(attachmentList, attachments);
        item.append(attachmentList);
    }
    body.append(thinking, contentElement, details);
    if (!(role === 'user' && attachments.length && !String(content ?? '').trim())) {
        item.append(body);
    }
    container.append(item);
    if (container === messagesElement) {
        welcomeElement.hidden = true;
        scrollToLatest(true);
    }
    return { item, thinking, contentElement, details };
}

function setAssistantContent(message, content, sources = []) {
    destroyCodeScrollbars(message.contentElement);
    message.contentElement.className = 'message-content';
    renderMessageContent(
        message.contentElement,
        Array.isArray(sources) && sources.length
            ? removeInlineSourceCitations(removeLeadingSourceSection(content), sources)
            : content,
    );
    addCodeCopyControls(message.contentElement);
    initializeCodeScrollbars(message.contentElement);
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

    for (const model of modelChoices) {
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
    const manage = document.createElement('button');
    manage.className = 'model-picker-manage';
    manage.type = 'button';
    manage.textContent = 'Manage models...';
    manage.addEventListener('click', () => {
        modelMenu.hidden = true;
        modelButton.setAttribute('aria-expanded', 'false');
        settings?.openSection('models');
    });
    modelMenu.append(manage);
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
        searchOption.hidden = !enabled;
        renderSelectedTools();
        renderToolMenu();
    },
});
searchOption.hidden = !settings.isSearchEnabled();

function updateSendButton() {
    const hasInput = Boolean(input.value.trim() || selectedAttachments.length);
    const isBusy = busySessions.has(conversationId);
    const isGenerating = activeStreams.has(conversationId)
        && generatingSessions.has(conversationId);
    form.classList.toggle('has-input', hasInput);
    form.classList.toggle('has-attachments', selectedAttachments.length > 0);
    form.classList.toggle('is-busy', isBusy);
    sendButton.disabled = isBusy
        || messagesElement.dataset.historyLoaded !== 'true'
        || !hasInput;
    stopButton.hidden = !isGenerating;
    stopButton.disabled = !isGenerating;
}

stopButton.addEventListener('click', async () => {
    const streamId = activeStreams.get(conversationId);
    if (!streamId) return;
    stopButton.disabled = true;
    try {
        await api(`/api/streams/${encodeURIComponent(streamId)}/stop`, { method: 'POST' });
    } catch (error) {
        stopButton.disabled = false;
        window.alert(`Could not stop the response: ${error.message}`);
    }
});

const textFileExtensions = new Set([
    'txt', 'md', 'markdown', 'rst', 'csv', 'tsv', 'json', 'jsonl', 'yaml', 'yml',
    'toml', 'xml', 'html', 'htm', 'css', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx',
    'py', 'pyi', 'java', 'c', 'h', 'cc', 'cpp', 'hpp', 'rs', 'go', 'rb', 'php',
    'sh', 'bash', 'zsh', 'sql', 'ps1', 'bat', 'cmd', 'diff', 'patch', 'ini',
    'conf', 'env', 'log', 'ipynb', 'mdx', 'vue', 'svelte', 'astro', 'kt', 'kts',
    'swift', 'dart', 'scala', 'sc', 'pl', 'pm', 'lua', 'r', 'm', 'mm', 'tex',
    'adoc', 'asciidoc', 'lock', 'tf', 'hcl', 'proto', 'graphql', 'gql', 'sol',
    'ex', 'exs', 'erl', 'hrl', 'hs', 'lhs', 'elm', 'clj', 'cljs', 'edn', 'fs',
    'fsx', 'cs', 'csx', 'vb', 'nix', 'fish', 'make', 'mk', 'gitignore',
    'gitattributes', 'editorconfig',
]);
const imageMimeByExtension = {
    '3fr': 'image/x-3fr', apng: 'image/apng', arw: 'image/x-sony-arw',
    avif: 'image/avif', bmp: 'image/bmp', cr2: 'image/x-canon-cr2',
    cr3: 'image/x-canon-cr3', cur: 'image/x-icon', dib: 'image/bmp',
    dng: 'image/x-adobe-dng', erf: 'image/x-epson-erf', exr: 'image/aces',
    gif: 'image/gif', heic: 'image/heic', heif: 'image/heif', icns: 'image/icns',
    ico: 'image/x-icon', j2c: 'image/jp2', j2k: 'image/jp2', jp2: 'image/jp2',
    jpe: 'image/jpeg', jpeg: 'image/jpeg', jpg: 'image/jpeg', jpf: 'image/jpx',
    jng: 'image/x-jng', jxl: 'image/jxl', kdc: 'image/x-kodak-kdc',
    mng: 'image/x-mng', mos: 'image/x-leaf-mos', mrw: 'image/x-minolta-mrw',
    nef: 'image/x-nikon-nef', nrw: 'image/x-nikon-nrw', orf: 'image/x-olympus-orf',
    pbm: 'image/x-portable-bitmap', pcx: 'image/x-pcx', pef: 'image/x-pentax-pef',
    pgm: 'image/x-portable-graymap', png: 'image/png', ppm: 'image/x-portable-pixmap',
    psd: 'image/vnd.adobe.photoshop', raf: 'image/x-fuji-raf', raw: 'image/x-raw',
    rw2: 'image/x-panasonic-rw2', sr2: 'image/x-sony-sr2', srf: 'image/x-sony-srf',
    svg: 'image/svg+xml', tga: 'image/x-tga', tif: 'image/tiff',
    tiff: 'image/tiff', webp: 'image/webp', xbm: 'image/x-xbitmap',
    xcf: 'image/x-xcf', xpm: 'image/x-xpixmap',
};

function getFileExtension(name) {
    const match = String(name).toLowerCase().match(/\.([a-z0-9]+)$/);
    return match ? match[1] : '';
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener('load', () => {
            if (typeof reader.result !== 'string') {
                reject(new Error(`Could not read ${file.name} as an image.`));
                return;
            }
            resolve(reader.result);
        });
        reader.addEventListener('error', () => reject(reader.error || new Error(`Could not read ${file.name}.`)));
        reader.readAsDataURL(file);
    });
}

async function prepareAttachment(file) {
    const extension = getFileExtension(file.name);
    const type = file.type.startsWith('image/')
        ? file.type
        : imageMimeByExtension[extension] || file.type || '';
    if (type.startsWith('image/')) {
        if (!file.size) throw new Error(`${file.name} is an empty image.`);
        return {
            id: crypto.randomUUID(),
            kind: 'image',
            name: file.name,
            type,
            data: await readFileAsDataUrl(file),
        };
    }
    if (!textFileExtensions.has(extension)) {
        throw new Error(`${file.name} is not a supported image, code, or text file.`);
    }
    const bytes = await file.arrayBuffer();
    let text;
    try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (error) {
        if (!(error instanceof TypeError)) throw error;
        throw new Error(`${file.name} is not a readable UTF-8 text file.`);
    }
    if (text.includes('\0')) {
        throw new Error(`${file.name} is binary and cannot be attached as text.`);
    }
    return { id: crypto.randomUUID(), kind: 'text', name: file.name, type, text };
}

function renderAttachments(container, attachments, { removable = false } = {}) {
    container.replaceChildren();
    for (const attachment of attachments) {
        const item = document.createElement('div');
        item.className = removable ? 'prompt-attachment' : 'message-attachment';
        if (attachment.kind === 'image' && attachment.data) {
            const image = document.createElement('img');
            image.className = removable ? 'prompt-attachment-image' : 'message-attachment-image';
            image.src = attachment.data;
            image.alt = attachment.name;
            image.addEventListener('error', () => {
                image.replaceWith(document.createTextNode(attachment.name));
            }, { once: true });
            item.append(image);
        } else {
            item.classList.add(removable ? 'prompt-attachment-file-item' : 'message-attachment-file-item');
            const fileIcon = document.createElement('img');
            fileIcon.className = 'attachment-file-icon';
            fileIcon.src = '/icon/file.png';
            fileIcon.alt = '';
            const fileLabel = document.createElement('span');
            fileLabel.className = 'attachment-file-name';
            fileLabel.textContent = attachment.name;
            item.append(fileIcon, fileLabel);
        }
        item.setAttribute('role', 'button');
        item.tabIndex = 0;
        item.setAttribute('aria-label', `Preview ${attachment.name}`);
        item.addEventListener('click', () => openAttachmentPreview(attachment, item));
        item.addEventListener('keydown', event => {
            if (event.target !== item) return;
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            openAttachmentPreview(attachment, item);
        });
        if (removable) {
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'prompt-attachment-remove';
            remove.setAttribute('aria-label', `Remove ${attachment.name}`);
            remove.title = `Remove ${attachment.name}`;
            remove.textContent = '×';
            remove.addEventListener('click', event => {
                event.stopPropagation();
                if (activeAttachmentPreview?.attachment.id === attachment.id) {
                    closeAttachmentPreview({ restoreFocus: false });
                }
                selectedAttachments = selectedAttachments.filter(item => item.id !== attachment.id);
                renderSelectedAttachments();
                resizePrompt();
                updateSendButton();
            });
            item.append(remove);
        } else {
            item.title = attachment.name;
        }
        container.append(item);
    }
}

function getAttachmentLanguage(name) {
    const extension = getFileExtension(name);
    const languages = {
        bash: 'bash', c: 'c', cc: 'cpp', cpp: 'cpp', cs: 'csharp', css: 'css',
        dart: 'dart', go: 'go', h: 'c', hpp: 'cpp', html: 'html', java: 'java',
        js: 'javascript', json: 'json', jsx: 'jsx', kt: 'kotlin', lua: 'lua',
        md: 'markdown', mjs: 'javascript', php: 'php', py: 'python', rb: 'ruby',
        rs: 'rust', sh: 'bash', sql: 'sql', swift: 'swift', ts: 'typescript',
        tsx: 'tsx', xml: 'xml', yaml: 'yaml', yml: 'yaml',
    };
    return languages[extension] || '';
}

function closeAttachmentPreview({ restoreFocus = true } = {}) {
    const preview = activeAttachmentPreview;
    imageViewer.hidden = true;
    imageViewer.classList.remove('is-zoomed');
    imageStage.classList.remove('is-dragging');
    imagePan = null;
    filePreview.classList.remove('is-open');
    window.clearTimeout(filePreviewCloseTimer);
    filePreviewCloseTimer = window.setTimeout(() => {
        if (!activeAttachmentPreview || activeAttachmentPreview.attachment.kind === 'image') {
            filePreview.hidden = true;
        }
    }, 240);
    fileCodeView.replaceChildren();
    fileCodeView.scrollTo(0, 0);
    activeAttachmentPreview = null;
    imageZoomMenu.hidden = true;
    imageZoomButton.setAttribute('aria-expanded', 'false');
    if (restoreFocus && preview?.element?.isConnected) preview.element.focus();
}

function setImageZoom(percent) {
    imageZoomPercent = percent;
    imageZoomButton.querySelector('span').textContent = `${percent}%`;
    imageZoomButton.setAttribute('aria-label', `Image zoom: ${percent}%`);
    imagePreview.style.width = `${imagePreview.naturalWidth * percent / 100}px`;
    imagePreview.style.height = `${imagePreview.naturalHeight * percent / 100}px`;
    for (const option of imageZoomMenu.querySelectorAll('[data-zoom]')) {
        option.setAttribute('aria-selected', String(Number(option.dataset.zoom) === percent));
    }
    requestAnimationFrame(() => {
        imageVerticalScroll.update();
        imageHorizontalScroll.update();
    });
}

function openAttachmentPreview(attachment, element) {
    closeAttachmentPreview({ restoreFocus: false });
    activeAttachmentPreview = { attachment, element };
    if (attachment.kind === 'image' && attachment.data) {
        imagePreviewTitle.textContent = attachment.name;
        imagePreview.src = attachment.data;
        imagePreview.alt = attachment.name;
        imageViewer.hidden = false;
        imageStage.scrollTo(0, 0);
        imageZoomMenu.hidden = true;
        imageZoomButton.setAttribute('aria-expanded', 'false');
        setImageZoom(imageZoomPercent);
        requestAnimationFrame(() => {
            imageVerticalScroll.update();
            imageHorizontalScroll.update();
        });
        imageCloseButton.focus();
        return;
    }

    filePreviewTitle.textContent = attachment.name;
    fileCodeView.replaceChildren();
    const rendered = document.createElement('div');
    rendered.className = 'message-content attachment-code-rendered';
    const language = getAttachmentLanguage(attachment.name);
    const text = attachment.text || '';
    let longestFence = 0;
    for (const match of text.matchAll(/`+/g)) {
        longestFence = Math.max(longestFence, match[0].length);
    }
    const fence = '`'.repeat(Math.max(3, longestFence + 1));
    try {
        renderMessageContent(rendered, `${fence}${language}\n${text}\n${fence}`);
    } catch (error) {
        console.error('[WEBUI] Could not render attached file preview:', error);
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        code.textContent = text;
        pre.append(code);
        rendered.append(pre);
    }

    const pre = rendered.querySelector('pre');
    if (pre) {
        const code = pre.querySelector('code');
        const lineCount = Math.max(
            1,
            text.split(/\r\n|\n|\r/).length - (/\r?\n$/.test(text) ? 1 : 0),
        );
        const line = document.createElement('div');
        line.className = 'attachment-code-line';
        const numbers = document.createElement('div');
        numbers.className = 'attachment-code-numbers';
        numbers.setAttribute('aria-hidden', 'true');
        numbers.innerHTML = Array.from({ length: lineCount }, (_, index) => `<span>${index + 1}</span>`).join('');
        pre.replaceWith(line);
        line.append(numbers, pre);
        if (code) code.setAttribute('aria-label', attachment.name);
    }
    fileCodeView.append(rendered);
    window.clearTimeout(filePreviewCloseTimer);
    filePreview.hidden = false;
    requestAnimationFrame(() => {
        filePreview.classList.add('is-open');
        fileVerticalScroll.update();
        fileHorizontalScroll.update();
    });
    fileCopyButton.focus();
}

function downloadAttachment(attachment) {
    let url = attachment.data;
    if (!url) {
        url = URL.createObjectURL(new Blob([attachment.text || ''], { type: attachment.type || 'text/plain' }));
    }
    const link = document.createElement('a');
    link.href = url;
    link.download = attachment.name;
    link.click();
    if (url.startsWith('blob:')) window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function showActionSuccess(button, label, ariaLabel) {
    window.clearTimeout(actionFeedbackTimers.get(button));
    button.classList.add('is-success');
    button.title = label;
    button.setAttribute('aria-label', ariaLabel);
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"></path></svg>';
    actionFeedbackTimers.set(button, window.setTimeout(() => {
        button.classList.remove('is-success');
        button.title = button.dataset.defaultTitle;
        button.setAttribute('aria-label', button.dataset.defaultLabel);
        button.innerHTML = button.dataset.defaultIcon;
    }, 1_500));
}

async function shareAttachment(attachment) {
    if (typeof navigator.share !== 'function') {
        window.alert('Sharing files is not supported by this browser.');
        return;
    }
    try {
        let file;
        if (attachment.kind === 'image') {
            const response = await fetch(attachment.data);
            if (!response.ok) throw new Error(`Could not read ${attachment.name} for sharing.`);
            file = new File([await response.blob()], attachment.name, { type: attachment.type });
        } else {
            file = new File([attachment.text || ''], attachment.name, {
                type: attachment.type || 'text/plain',
            });
        }
        if (typeof navigator.canShare === 'function' && !navigator.canShare({ files: [file] })) {
            throw new Error('Sharing files is not supported by this browser.');
        }
        await navigator.share({ files: [file], title: attachment.name });
    } catch (error) {
        if (error.name === 'AbortError') return;
        console.error('[WEBUI] Could not share attachment:', error);
        window.alert(`Could not share ${attachment.name}: ${error.message}`);
    }
}

imageCloseButton.addEventListener('click', () => closeAttachmentPreview());
fileCloseButton.addEventListener('click', () => closeAttachmentPreview());
imageViewer.addEventListener('click', event => {
    if (event.target === imageViewer) closeAttachmentPreview();
});
imageZoomButton.addEventListener('click', () => {
    imageZoomMenu.hidden = !imageZoomMenu.hidden;
    imageZoomButton.setAttribute('aria-expanded', String(!imageZoomMenu.hidden));
});
imageZoomMenu.addEventListener('click', event => {
    const option = event.target.closest('[data-zoom]');
    if (!option) return;
    setImageZoom(Number(option.dataset.zoom));
    imageZoomMenu.hidden = true;
    imageZoomButton.setAttribute('aria-expanded', 'false');
});
document.addEventListener('click', event => {
    if (imageZoomButton.contains(event.target) || imageZoomMenu.contains(event.target)) return;
    imageZoomMenu.hidden = true;
    imageZoomButton.setAttribute('aria-expanded', 'false');
});
imagePreview.addEventListener('load', () => setImageZoom(imageZoomPercent));
imagePreview.addEventListener('dragstart', event => event.preventDefault());
imageStage.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target !== imagePreview) return;
    if (imageStage.scrollWidth <= imageStage.clientWidth + 1
        && imageStage.scrollHeight <= imageStage.clientHeight + 1) return;
    imagePan = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        scrollLeft: imageStage.scrollLeft,
        scrollTop: imageStage.scrollTop,
    };
    imageStage.classList.add('is-dragging');
    imageStage.setPointerCapture(event.pointerId);
    event.preventDefault();
});
imageStage.addEventListener('pointermove', event => {
    if (!imagePan || imagePan.pointerId !== event.pointerId) return;
    imageStage.scrollLeft = imagePan.scrollLeft + imagePan.clientX - event.clientX;
    imageStage.scrollTop = imagePan.scrollTop + imagePan.clientY - event.clientY;
});
const stopImageDrag = event => {
    if (!imagePan || imagePan.pointerId !== event.pointerId) return;
    imagePan = null;
    imageStage.classList.remove('is-dragging');
};
imageStage.addEventListener('pointerup', stopImageDrag);
imageStage.addEventListener('pointercancel', stopImageDrag);
imageDownloadButton.addEventListener('click', () => {
    if (!activeAttachmentPreview) return;
    try {
        downloadAttachment(activeAttachmentPreview.attachment);
        showActionSuccess(imageDownloadButton, 'Downloaded', 'Image download started');
    } catch (error) {
        console.error('[WEBUI] Could not download image attachment:', error);
        window.alert(`Could not download ${activeAttachmentPreview.attachment.name}: ${error.message}`);
    }
});
imageShareButton.addEventListener('click', () => {
    if (activeAttachmentPreview) shareAttachment(activeAttachmentPreview.attachment);
});
fileDownloadButton.addEventListener('click', () => {
    if (!activeAttachmentPreview) return;
    try {
        downloadAttachment(activeAttachmentPreview.attachment);
        showActionSuccess(fileDownloadButton, 'Downloaded', 'File download started');
    } catch (error) {
        console.error('[WEBUI] Could not download file attachment:', error);
        window.alert(`Could not download ${activeAttachmentPreview.attachment.name}: ${error.message}`);
    }
});
fileShareButton.addEventListener('click', () => {
    if (activeAttachmentPreview) shareAttachment(activeAttachmentPreview.attachment);
});
fileCopyButton.addEventListener('click', async () => {
    if (!activeAttachmentPreview) return;
    try {
        await navigator.clipboard.writeText(activeAttachmentPreview.attachment.text || '');
        showActionSuccess(fileCopyButton, 'Copied', 'File contents copied');
    } catch (error) {
        console.error('[WEBUI] Could not copy attached file:', error);
        window.alert(`Could not copy ${activeAttachmentPreview.attachment.name}: ${error.message}`);
    }
});
for (const button of [imageDownloadButton, fileCopyButton, fileDownloadButton]) {
    button.dataset.defaultTitle = button.title;
    button.dataset.defaultLabel = button.getAttribute('aria-label');
    button.dataset.defaultIcon = button.innerHTML;
}

fileResizeHandle.addEventListener('pointerdown', event => {
    if (event.button !== 0 || window.innerWidth <= 700) return;
    filePreviewResize = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: filePreview.getBoundingClientRect().width,
    };
    filePreview.classList.add('is-resizing');
    fileResizeHandle.setPointerCapture(event.pointerId);
    event.preventDefault();
});
fileResizeHandle.addEventListener('pointermove', event => {
    if (!filePreviewResize || event.pointerId !== filePreviewResize.pointerId) return;
    const minWidth = 280;
    const maxWidth = Math.max(minWidth, Math.floor(window.innerWidth * 0.75));
    const width = Math.min(maxWidth, Math.max(
        minWidth,
        filePreviewResize.startWidth + filePreviewResize.startX - event.clientX,
    ));
    filePreview.style.width = `${width}px`;
    fileResizeHandle.setAttribute('aria-valuenow', String(Math.round(width)));
});
const finishFilePreviewResize = event => {
    if (!filePreviewResize || event.pointerId !== filePreviewResize.pointerId) return;
    filePreviewResize = null;
    filePreview.classList.remove('is-resizing');
};
fileResizeHandle.addEventListener('pointerup', finishFilePreviewResize);
fileResizeHandle.addEventListener('pointercancel', finishFilePreviewResize);
fileResizeHandle.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const currentWidth = filePreview.getBoundingClientRect().width;
    const delta = event.key === 'ArrowLeft' ? 24 : -24;
    const minWidth = 280;
    const maxWidth = Math.max(minWidth, Math.floor(window.innerWidth * 0.75));
    const width = Math.min(maxWidth, Math.max(minWidth, currentWidth + delta));
    filePreview.style.width = `${width}px`;
    fileResizeHandle.setAttribute('aria-valuenow', String(Math.round(width)));
});
window.addEventListener('resize', () => {
    if (filePreview.hidden || window.innerWidth <= 700) return;
    const minWidth = 280;
    const maxWidth = Math.max(minWidth, Math.floor(window.innerWidth * 0.75));
    const width = Math.min(maxWidth, Math.max(minWidth, filePreview.getBoundingClientRect().width));
    filePreview.style.width = `${width}px`;
    fileResizeHandle.setAttribute('aria-valuemax', String(maxWidth));
    fileResizeHandle.setAttribute('aria-valuenow', String(Math.round(width)));
});
document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (!imageZoomMenu.hidden) {
        imageZoomMenu.hidden = true;
        imageZoomButton.setAttribute('aria-expanded', 'false');
        imageZoomButton.focus();
        return;
    }
    if (activeAttachmentPreview) closeAttachmentPreview();
});

function renderSelectedAttachments() {
    const hasAttachments = selectedAttachments.length > 0;
    renderAttachments(promptAttachmentsElement, selectedAttachments, { removable: true });
    form.classList.toggle('has-attachments', hasAttachments);
    updateAddButtonPlacement();
}

function updateAddButtonPlacement() {
    if (selectedAttachments.length || form.classList.contains('multiline')) {
        composerActions.prepend(addButton);
    } else {
        promptInputWrap.prepend(addButton);
    }
}

filesInput.addEventListener('change', async () => {
    const files = Array.from(filesInput.files || []);
    filesInput.value = '';
    const errors = [];
    for (const file of files) {
        try {
            selectedAttachments.push(await prepareAttachment(file));
        } catch (error) {
            errors.push(error.message);
        }
    }
    renderSelectedAttachments();
    resizePrompt();
    updateSendButton();
    if (errors.length) window.alert(errors.join('\n'));
});

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
        tool.name !== 'search'
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
        if (toolName === 'search') {
            const token = document.createElement('span');
            token.className = 'selected-tool selected-search-tool';
            const icon = document.createElement('img');
            icon.src = '/icon/search.png';
            icon.alt = '';
            icon.width = 14;
            icon.height = 14;
            const label = document.createElement('span');
            label.textContent = 'Search on the Internet';
            token.append(icon, label);
            selectedToolsElement.append(token);
            continue;
        }
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
    selectedToolsElement.hidden = selectedTools.length === 0;
    form.classList.toggle('has-tools', selectedTools.some(name => name !== 'search'));
}

function closeAddMenu() {
    addMenu.hidden = true;
    addButton.setAttribute('aria-expanded', 'false');
}

function selectSearchTool() {
    if (settings?.isSearchEnabled() === false) return;
    if (!selectedTools.includes('search')) selectedTools.push('search');
    renderSelectedTools();
    closeAddMenu();
    input.focus();
}

addButton.addEventListener('click', () => {
    const shouldOpen = addMenu.hidden;
    closeToolMenu();
    addMenu.hidden = !shouldOpen;
    addButton.setAttribute('aria-expanded', String(shouldOpen));
});

addFilesOption.addEventListener('click', () => {
    closeAddMenu();
    filesInput.click();
});

searchOption.addEventListener('click', selectSearchTool);

document.addEventListener('click', event => {
    if (!promptInputWrap.contains(event.target)
        && !addButton.contains(event.target)
        && !addMenu.contains(event.target)) closeAddMenu();
    if (!form.contains(event.target)) closeToolMenu();
});

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
    const hasFixedColumnLayout = form.classList.contains('has-tools')
        || form.classList.contains('has-attachments');
    if (!hasFixedColumnLayout) {
        form.classList.remove('multiline');
        updateAddButtonPlacement();
    }
    input.style.height = 'auto';
    const height = input.value ? input.scrollHeight : 32;
    const multiline = height > 48;
    form.classList.toggle('multiline', multiline);
    input.style.height = `${Math.min(height, 170)}px`;
    updateAddButtonPlacement();
    updatePromptScrollBar();
}

async function watchAssistantStream(
    streamId,
    response,
    temporaryMessages = null,
    sessionId = conversationId,
) {
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
                    if (data.state === 'thinking') {
                        loading.setLabel('Thinking…');
                        if (sessionId) {
                            generatingSessions.add(sessionId);
                            if (sessionId === conversationId) updateSendButton();
                        }
                    }
                    if (data.state === 'complete' || data.state === 'error') {
                        loading.finish();
                        if (sessionId) {
                            generatingSessions.delete(sessionId);
                            if (sessionId === conversationId) updateSendButton();
                        }
                    }
                } else if (type === 'thinking') {
                    if (sessionId) {
                        generatingSessions.add(sessionId);
                        if (sessionId === conversationId) updateSendButton();
                    }
                    loading.appendThinking(data.text || '');
                    if (messagesElement.contains(response.item)) scrollToLatest(false);
                } else if (type === 'delta') {
                    if (sessionId) {
                        generatingSessions.add(sessionId);
                        if (sessionId === conversationId) updateSendButton();
                    }
                    loading.setGenerating();
                    renderedText += data.text;
                    scheduleRender();
                } else if (type === 'streamaddon') {
                    renderStreamDetails(response.details, data);
                } else if (type === 'done') {
                    if (data.message?.thinking) loading.setThinking(data.message.thinking);
                    loading.finish();
                    flushRender(data.message.content, data.message.sources);
                } else if (type === 'stopped') {
                    if (sessionId) {
                        generatingSessions.delete(sessionId);
                        if (sessionId === conversationId) updateSendButton();
                    }
                    loading.finish();
                    response.item.classList.add('stopped');
                    flushRender(renderedText);
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
        if (temporaryMessages) {
            temporaryMessages.push({
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
    if (
        selectedTools.includes('search')
        && (event.key === 'Backspace' || event.key === 'Delete')
        && input.selectionStart === 0
        && input.selectionEnd === 0
    ) {
        event.preventDefault();
        selectedTools = selectedTools.filter(name => name !== 'search');
        renderSelectedTools();
        return;
    }
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
    if (event.key === 'Escape' && !addMenu.hidden) {
        closeAddMenu();
        return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        form.requestSubmit();
    }
});

form.addEventListener('submit', async event => {
    event.preventDefault();
    const messageText = input.value.trim();
    if ((!messageText && !selectedAttachments.length) || busySessions.has(conversationId)
        || messagesElement.dataset.historyLoaded !== 'true') return;
    const requestText = messageText || 'Please analyze the attached file(s).';
    const sessionId = conversationId;
    const messageContainer = messagesElement;
    const tools = [...selectedTools];
    const attachments = selectedAttachments.map(({ id, ...attachment }) => attachment);
    const temporaryMessages = isTempChat ? tempMessagesList : null;

    busySessions.add(sessionId);
    messageContainer.dataset.historyLoaded = 'true';
    updateSendButton();
    setEmptyChatLayout(false);
    userPinnedToBottom = true;
    addMessage('user', messageText, { tools, attachments });
    if (temporaryMessages) {
        temporaryMessages.push({ role: 'user', content: requestText, tools, attachments });
    }
    chatActions.hidden = false;
    if (chatTitleButton) chatTitleButton.hidden = Boolean(temporaryMessages);
    input.value = '';
    closeAttachmentPreview({ restoreFocus: false });
    selectedAttachments = [];
    renderSelectedAttachments();
    selectedTools = [];
    renderSelectedTools();
    closeToolMenu();
    resizePrompt();
    const response = addMessage('assistant', '', {}, messageContainer);
    // Show the more button after assistant message is added
    if (chatTitleButton) chatTitleButton.hidden = Boolean(temporaryMessages);

    try {
        const streamId = await startChatStream({
            conversationId: sessionId,
            message: requestText,
            think: getThinkParam(),
            tools,
            attachments,
            isTemporary: Boolean(temporaryMessages),
            messages: temporaryMessages || [],
        });
        activeStreams.set(sessionId, streamId);
        if (sessionId === conversationId) updateSendButton();
        if (!temporaryMessages) {
            sidebar.loadConversations().catch(error => {
                console.error('[WEBUI] Could not refresh conversation list:', error);
            });
        }
        await watchAssistantStream(streamId, response, temporaryMessages, sessionId);
    } catch (error) {
        response.item.classList.add('error');
        response.contentElement.className = 'message-content';
        response.contentElement.textContent = error.message;
    } finally {
        busySessions.delete(sessionId);
        generatingSessions.delete(sessionId);
        activeStreams.delete(sessionId);
        if (sessionId === conversationId) {
            updateSendButton();
            input.focus();
        }
        if (!temporaryMessages) {
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
        if (chatTitleButton) chatTitleButton.hidden = isTempChat;
    }
    try {
        await watchAssistantStream(
            result.streamId,
            addMessage('assistant', '', {}, messageContainer),
            null,
            sessionId,
        );
    } finally {
        activeStreams.delete(sessionId);
        generatingSessions.delete(sessionId);
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
    closeAttachmentPreview({ restoreFocus: false });
    const sequence = ++switchSequence;
    sessionDrafts.set(conversationId, input.value);
    sessionDraftAttachments.set(conversationId, selectedAttachments);
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
    if (chatTitleButton) chatTitleButton.hidden = isTempChat || !hasAssistantMessage(nextMessages);
    setEmptyChatLayout(cachedIsEmpty);

    // Reset welcome text to random message when switching to empty session
    if (cachedIsEmpty && !isTempChat) {
        document.getElementById('welcome-text').textContent = WELCOME_MESSAGES[Math.floor(Math.random() * WELCOME_MESSAGES.length)];
        document.getElementById('welcome-subtitle').hidden = true;
    }

    input.value = sessionDrafts.get(sessionId) || '';
    selectedAttachments = sessionDraftAttachments.get(sessionId) || [];
    renderSelectedAttachments();
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
    if (chatTitleButton) chatTitleButton.hidden = isTempChat || !hasAssistantMessage(messagesElement);
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
        if (chatTitleButton) chatTitleButton.hidden = isTempChat || !hasAssistantMessage(messagesElement);
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
