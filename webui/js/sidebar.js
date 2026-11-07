import { selectSession, startNewSession } from './session.js';

export function initializeSidebar({ api, sessionId }) {
    const appElement = document.getElementById('app');
    const list = document.getElementById('conversation-list');
    const pinnedSection = document.getElementById('pinned-section');
    const pinnedList = document.getElementById('pinned-list');
    const deleteDialog = document.getElementById('delete-dialog');
    const deleteTitle = document.getElementById('delete-chat-title');

    // Search modal elements
    const searchOverlay = document.getElementById('search-overlay');
    const searchInput = document.getElementById('search-modal-input');
    const searchResults = document.getElementById('search-results');
    const searchCloseBtn = document.getElementById('search-modal-close');
    const activeMenuButton = document.getElementById('chat-more-button');
    const activeMenu = document.getElementById('active-chat-menu');
    let activeSessionId = sessionId;
    let refreshTimer = null;

    /** All loaded conversations (cache for search) */
    let allConversations = [];

    // ─── Conversation CRUD helpers ────────────────────────────────────────────

    async function updateConversation(id, action, extra = {}) {
        return api(`/api/conversations/${encodeURIComponent(id)}`, {
            method: 'POST',
            body: JSON.stringify({ action, ...extra }),
        });
    }

    function showConversationError(error) {
        window.alert(`Could not update the conversation: ${error.message}`);
    }

    function confirmDelete(title) {
        deleteTitle.textContent = `"${title}"`;
        return new Promise(resolve => {
            deleteDialog.addEventListener('close', () => {
                resolve(deleteDialog.returnValue === 'delete');
            }, { once: true });
            deleteDialog.showModal();
        });
    }

    // ─── Rename inline form ───────────────────────────────────────────────────

    function beginRename(conversation, row, item) {
        const form = document.createElement('form');
        form.className = 'conversation-rename-form';
        const input = document.createElement('input');
        input.className = 'conversation-rename-input';
        input.type = 'text';
        input.maxLength = 100;
        input.value = conversation.preview;
        input.setAttribute('aria-label', 'Conversation title');
        const error = document.createElement('span');
        error.className = 'conversation-rename-error';
        error.setAttribute('role', 'status');

        const handleOutsideClick = event => {
            if (!form.contains(event.target)) closeRename();
        };
        const closeRename = (restoreFocus = true) => {
            document.removeEventListener('click', handleOutsideClick);
            row.classList.remove('rename-active');
            if (form.parentElement === row) {
                row.replaceChild(item, form);
                if (restoreFocus) item.focus();
            }
        };
        form.append(input, error);
        row.classList.add('rename-active');
        row.replaceChild(form, item);
        input.focus();
        input.select();
        queueMicrotask(() => document.addEventListener('click', handleOutsideClick));

        input.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeRename();
            }
        });
        form.addEventListener('submit', async event => {
            event.preventDefault();
            const title = input.value.trim();
            if (!title || title.length > 100) {
                error.textContent = 'The title must be between 1 and 100 characters.';
                input.focus();
                return;
            }
            input.disabled = true;
            try {
                await updateConversation(conversation.conversation_id, 'rename', { title });
                closeRename(false);
                await loadConversations();
            } catch (updateError) {
                input.disabled = false;
                error.textContent = `Could not rename the conversation: ${updateError.message}`;
                input.focus();
            }
        });
    }

    // ─── Load & render conversation list ──────────────────────────────────────

    async function loadConversations() {
        const { conversations } = await api('/api/conversations?archived=all');
        const visibleConversations = conversations.filter(
            conversation => !conversation.conversation_id.startsWith('temp-'),
        );
        allConversations = visibleConversations; // cache for search
        document.querySelectorAll('.conversation-menu:not(.chat-menu)').forEach(el => el.remove());
        list.replaceChildren();
        pinnedList.replaceChildren();
        const pinnedConversations = visibleConversations.filter(
            conversation => conversation.metadata?.pinned,
        );
        const otherConversations = visibleConversations.filter(
            conversation => !conversation.metadata?.pinned,
        );
        pinnedSection.hidden = pinnedConversations.length === 0;
        if (visibleConversations.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'conversation-empty';
            empty.textContent = 'No conversations yet';
            list.append(empty);
            return;
        }

        for (const conversation of visibleConversations) {
            const targetList = conversation.metadata?.pinned ? pinnedList : list;
            const row = document.createElement('div');
            row.className = 'conversation-row';
            if (conversation.conversation_id === activeSessionId) {
                row.setAttribute('aria-current', 'page');
            }

            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'conversation-item';
            if (conversation.is_generating) {
                const spinner = document.createElement('span');
                spinner.className = 'conversation-title-spinner';
                spinner.setAttribute('aria-label', 'Agent is working');
                item.append(spinner);
            }
            const title = document.createElement('span');
            title.className = 'conversation-title';
            title.textContent = conversation.preview;
            item.append(title);
            item.title = conversation.preview;
            item.addEventListener('click', () => selectSession(conversation.conversation_id));
            row.dataset.conversationId = conversation.conversation_id;

            const actions = document.createElement('div');
            actions.className = 'conversation-actions';

            const pin = document.createElement('button');
            pin.type = 'button';
            pin.className = 'conversation-action';
            if (conversation.metadata?.pinned) pin.classList.add('pinned');
            const pinImg = document.createElement('img');
            pinImg.src = '/icon/pin.png';
            pinImg.width = 12;
            pinImg.height = 12;
            pinImg.alt = conversation.metadata?.pinned ? 'Unpin' : 'Pin';
            pinImg.className = 'action-icon pin-icon';
            pin.append(pinImg);
            pin.title = conversation.metadata?.pinned ? 'Unpin' : 'Pin';
            pin.setAttribute('aria-label', pin.title);
            pin.setAttribute('aria-pressed', String(Boolean(conversation.metadata?.pinned)));
            pin.addEventListener('click', async event => {
                event.stopPropagation();
                try {
                    await updateConversation(
                        conversation.conversation_id,
                        'pin',
                        { value: !conversation.metadata?.pinned },
                    );
                    await loadConversations();
                } catch (err) {
                    showConversationError(err);
                }
            });

            const more = document.createElement('button');
            more.type = 'button';
            more.className = 'conversation-action';
            const dotsImg = document.createElement('img');
            dotsImg.src = '/icon/dots.png';
            dotsImg.width = 13;
            dotsImg.height = 13;
            dotsImg.alt = 'Options';
            dotsImg.className = 'action-icon dots-icon';
            more.append(dotsImg);
            more.title = 'Options';
            more.setAttribute('aria-label', 'Conversation options');
            more.setAttribute('aria-expanded', 'false');

            const menu = document.createElement('div');
            menu.className = 'conversation-menu';
            menu.hidden = true;

            more.addEventListener('click', event => {
                event.stopPropagation();
                const opening = menu.hidden;
                document.querySelectorAll('.conversation-menu').forEach(el => { el.hidden = true; });
                document.querySelectorAll('.conversation-action[aria-expanded]').forEach(el => {
                    el.setAttribute('aria-expanded', 'false');
                });
                if (opening) {
                    menu.hidden = false;
                    const bounds = more.getBoundingClientRect();
                    const left = Math.min(
                        Math.max(8, bounds.right - menu.offsetWidth),
                        window.innerWidth - menu.offsetWidth - 8,
                    );
                    const below = bounds.bottom + 4;
                    const top = below + menu.offsetHeight <= window.innerHeight - 8
                        ? below
                        : Math.max(8, bounds.top - menu.offsetHeight - 4);
                    menu.style.left = `${left}px`;
                    menu.style.top = `${top}px`;
                    menu.hidden = false;
                } else {
                    menu.hidden = true;
                }
                more.setAttribute('aria-expanded', String(opening));
            });

            const addMenuAction = (label, action, extra = {}, danger = false) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.textContent = label;
                if (danger) button.classList.add('danger');
                button.addEventListener('click', async event => {
                    event.stopPropagation();
                    menu.hidden = true;
                    try {
                        if (action === 'rename') {
                            beginRename(conversation, row, item);
                            return;
                        } else if (action === 'delete') {
                            if (!await confirmDelete(conversation.preview)) return;
                            await updateConversation(conversation.conversation_id, action);
                            if (conversation.conversation_id === activeSessionId) {
                                startNewSession();
                                return;
                            }
                        } else {
                            await updateConversation(conversation.conversation_id, action, extra);
                        }
                        await loadConversations();
                    } catch (err) {
                        showConversationError(err);
                    }
                });
                menu.append(button);
            };

            addMenuAction('Rename', 'rename');
            addMenuAction(
                conversation.metadata?.archived ? 'Unarchive' : 'Archive',
                'archive',
                { value: !conversation.metadata?.archived },
            );
            addMenuAction('Delete', 'delete', {}, true);
            actions.append(pin, more);
            row.append(item, actions);
            targetList.append(row);
            document.body.append(menu);
        }
        if (otherConversations.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'conversation-empty';
            empty.textContent = 'No other conversations';
            list.append(empty);
        }
        if (refreshTimer) window.clearTimeout(refreshTimer);
        refreshTimer = window.setTimeout(
            () => loadConversations().catch(showConversationError),
            conversations.some(conversation => conversation.is_generating) ? 1200 : 5000,
        );
    }

    function openMenu(button, menu) {
        const opening = menu.hidden;
        document.querySelectorAll('.conversation-menu').forEach(element => { element.hidden = true; });
        document.querySelectorAll('.conversation-action[aria-expanded], .chat-more-button[aria-expanded]')
            .forEach(element => element.setAttribute('aria-expanded', 'false'));
        if (!opening) return;

        menu.hidden = false;
        const bounds = button.getBoundingClientRect();
        const left = Math.min(
            Math.max(8, bounds.right - menu.offsetWidth),
            window.innerWidth - menu.offsetWidth - 8,
        );
        const below = bounds.bottom + 4;
        menu.style.left = `${left}px`;
        menu.style.top = below + menu.offsetHeight <= window.innerHeight - 8
            ? `${below}px`
            : `${Math.max(8, bounds.top - menu.offsetHeight - 4)}px`;
        button.setAttribute('aria-expanded', 'true');
    }

    function activeConversation() {
        return allConversations.find(conversation => (
            conversation.conversation_id === activeSessionId
        ));
    }

    function activeRowAndItem(conversation) {
        const row = [...document.querySelectorAll('.conversation-row')].find(element => (
            element.dataset.conversationId === conversation.conversation_id
        ));
        return row ? { row, item: row.querySelector('.conversation-item') } : null;
    }

    function safeFilename(title) {
        const base = title.toLowerCase()
            .replace(/[^a-z0-9_-]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 60);
        return base || 'zeus-conversation';
    }

    async function exportConversation(conversation, format, printWindow = null) {
        const { messages } = await api(
            `/api/history?conversationId=${encodeURIComponent(conversation.conversation_id)}`,
        );
        const printable = messages
            .filter(message => message.role === 'user' || message.role === 'assistant')
            .map(message => `<section><h2>${escapeHtml(message.role === 'user' ? 'You' : 'ZEUS')}</h2><p>${escapeHtml(message.content || '')}</p></section>`)
            .join('');
        const page = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(conversation.preview)}</title><style>body{font:15px/1.6 Arial,sans-serif;max-width:820px;margin:40px auto;color:#222}h1{font-size:24px}h2{font-size:13px;color:#6b4b32}section{margin:24px 0;white-space:pre-wrap;overflow-wrap:anywhere}</style></head><body><h1>${escapeHtml(conversation.preview)}</h1>${printable}</body></html>`;
        const filename = safeFilename(conversation.preview);

        if (format === 'pdf') {
            if (!printWindow) throw new Error('The PDF print window could not be opened.');
            printWindow.document.open();
            printWindow.document.write(page);
            printWindow.document.close();
            window.setTimeout(() => {
                printWindow.focus();
                printWindow.print();
            }, 250);
            return;
        }

        const blob = new Blob([page], { type: 'application/msword;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${filename}.doc`;
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function addActiveMenuAction(label, action, danger = false) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.dataset.action = action;
        if (danger) button.classList.add('danger');
        button.addEventListener('click', async () => {
            activeMenu.hidden = true;
            activeMenuButton.setAttribute('aria-expanded', 'false');
            const conversation = activeConversation();
            if (!conversation) return;
            try {
                if (action === 'rename') {
                    const target = activeRowAndItem(conversation);
                    if (target) beginRename(conversation, target.row, target.item);
                    return;
                }
                if (action === 'delete') {
                    if (!await confirmDelete(conversation.preview)) return;
                    await updateConversation(conversation.conversation_id, 'delete');
                    if (conversation.conversation_id === activeSessionId) startNewSession();
                    await loadConversations();
                    return;
                }
                if (action === 'pin') {
                    await updateConversation(conversation.conversation_id, 'pin', {
                        value: !conversation.metadata?.pinned,
                    });
                    await loadConversations();
                    return;
                }
                let printWindow = null;
                if (action === 'pdf') {
                    printWindow = window.open('', '_blank');
                    if (!printWindow) throw new Error('Allow pop-ups to print this conversation as PDF.');
                }
                await exportConversation(conversation, action, printWindow);
            } catch (error) {
                showConversationError(error);
            }
        });
        activeMenu.append(button);
    }

    addActiveMenuAction('Pin', 'pin');
    addActiveMenuAction('Rename', 'rename');
    addActiveMenuAction('Download PDF', 'pdf');
    addActiveMenuAction('Export document (.doc)', 'doc');
    addActiveMenuAction('Delete', 'delete', true);
    activeMenuButton.addEventListener('click', () => {
        const conversation = activeConversation();
        const pinAction = activeMenu.querySelector('[data-action="pin"]');
        if (conversation && pinAction) {
            pinAction.textContent = conversation.metadata?.pinned ? 'Unpin' : 'Pin';
        }
        openMenu(activeMenuButton, activeMenu);
    });

    // ─── Search modal ─────────────────────────────────────────────────────────

    function escapeHtml(str) {
        return str.replace(/[&<>"']/g, c => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
        ));
    }

    function highlightMatch(text, query) {
        if (!query) return escapeHtml(text);
        const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`(${escaped})`, 'gi');
        return escapeHtml(text).replace(re, '<mark>$1</mark>');
    }

    function renderSearchResults(query) {
        const q = query.trim().toLowerCase();
        const filtered = q
            ? allConversations.filter(c => c.preview.toLowerCase().includes(q))
            : allConversations;

        searchResults.replaceChildren();

        if (filtered.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'search-result-empty';
            empty.textContent = q ? `No conversations matching "${query}"` : 'No conversations yet';
            searchResults.append(empty);
            return;
        }

        for (const conv of filtered) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'search-result-item';

            const iconEl = document.createElement('div');
            iconEl.className = 'search-result-icon';
            iconEl.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;

            const label = document.createElement('span');
            label.innerHTML = highlightMatch(conv.preview, query);
            label.style.cssText = 'min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

            btn.append(iconEl, label);
            btn.addEventListener('click', () => {
                closeSearch();
                selectSession(conv.conversation_id);
            });
            searchResults.append(btn);
        }
    }

    function openSearch() {
        const modal = document.getElementById('search-modal');
        // Reset animation so it replays on each open
        modal.style.animation = 'none';
        searchOverlay.hidden = false;
        requestAnimationFrame(() => { modal.style.animation = ''; });
        searchInput.value = '';
        renderSearchResults('');
        searchInput.focus();
    }

    function closeSearch() {
        searchOverlay.hidden = true;
    }

    // Live filter as user types
    searchInput.addEventListener('input', () => renderSearchResults(searchInput.value));

    // Escape key closes modal
    searchInput.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); closeSearch(); }
    });

    // Close button
    searchCloseBtn.addEventListener('click', closeSearch);

    // Click outside modal card closes it
    searchOverlay.addEventListener('click', event => {
        if (event.target === searchOverlay) closeSearch();
    });

    // ─── Sidebar open/close toggle ────────────────────────────────────────────

    function setMenuOpen(open) {
        appElement.classList.toggle('menu-closed', !open);
        const toggle = document.getElementById('menu-toggle');
        toggle.setAttribute('aria-expanded', String(open));
        toggle.setAttribute('aria-label', open ? 'Collapse menu' : 'Expand menu');
    }

    // Open sidebar wiring
    document.getElementById('new-chat').addEventListener('click', startNewSession);
    document.getElementById('sidebar-search-btn').addEventListener('click', openSearch);

    // Collapsed sidebar icon wiring
    document.getElementById('collapsed-new-chat').addEventListener('click', startNewSession);
    document.getElementById('collapsed-search').addEventListener('click', openSearch);

    document.getElementById('menu-toggle').addEventListener('click', () => {
        setMenuOpen(appElement.classList.contains('menu-closed'));
    });

    const conversationToggle = document.getElementById('conversation-toggle');
    conversationToggle.addEventListener('click', () => {
        const expanded = conversationToggle.getAttribute('aria-expanded') === 'true';
        conversationToggle.setAttribute('aria-expanded', String(!expanded));
        list.hidden = expanded;
    });
    const pinnedToggle = document.getElementById('pinned-toggle');
    pinnedToggle.addEventListener('click', () => {
        const expanded = pinnedToggle.getAttribute('aria-expanded') === 'true';
        pinnedToggle.setAttribute('aria-expanded', String(!expanded));
        pinnedList.hidden = expanded;
    });

    document.addEventListener('click', event => {
        if (event.target.closest('.conversation-row, .conversation-menu, .chat-actions')) return;
        document.querySelectorAll('.conversation-menu').forEach(el => { el.hidden = true; });
        document.querySelectorAll('.conversation-action[aria-expanded], .chat-more-button[aria-expanded]').forEach(el => {
            el.setAttribute('aria-expanded', 'false');
        });
    });

    const mobileLayout = window.matchMedia('(max-width: 700px)');
    setMenuOpen(!mobileLayout.matches);
    mobileLayout.addEventListener('change', event => setMenuOpen(!event.matches));

    return {
        loadConversations,
        setSessionId(id) {
            activeSessionId = id;
            document.querySelectorAll('.conversation-row').forEach(row => {
                if (row.dataset.conversationId === id) row.setAttribute('aria-current', 'page');
                else row.removeAttribute('aria-current');
            });
        },
    };
}