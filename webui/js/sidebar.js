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
        allConversations = conversations; // cache for search
        document.querySelectorAll('.conversation-menu').forEach(el => el.remove());
        list.replaceChildren();
        pinnedList.replaceChildren();
        const pinnedConversations = conversations.filter(
            conversation => conversation.metadata?.pinned,
        );
        const otherConversations = conversations.filter(
            conversation => !conversation.metadata?.pinned,
        );
        pinnedSection.hidden = pinnedConversations.length === 0;
        if (conversations.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'conversation-empty';
            empty.textContent = 'No conversations yet';
            list.append(empty);
            return;
        }

        for (const conversation of conversations) {
            const targetList = conversation.metadata?.pinned ? pinnedList : list;
            const row = document.createElement('div');
            row.className = 'conversation-row';
            if (conversation.conversation_id === sessionId) {
                row.setAttribute('aria-current', 'page');
            }

            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'conversation-item';
            item.textContent = conversation.preview;
            item.title = conversation.preview;
            item.addEventListener('click', () => selectSession(conversation.conversation_id));

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
                            if (conversation.conversation_id === sessionId) {
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
    }

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
        if (event.target.closest('.conversation-row, .conversation-menu')) return;
        document.querySelectorAll('.conversation-menu').forEach(el => { el.hidden = true; });
        document.querySelectorAll('.conversation-action[aria-expanded]').forEach(el => {
            el.setAttribute('aria-expanded', 'false');
        });
    });

    const mobileLayout = window.matchMedia('(max-width: 700px)');
    setMenuOpen(!mobileLayout.matches);
    mobileLayout.addEventListener('change', event => setMenuOpen(!event.matches));

    return { loadConversations };
}