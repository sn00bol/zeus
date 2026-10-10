import { selectSession, startNewSession } from './session.js';

export function initializeSidebar({ api, sessionId }) {
    const appElement = document.getElementById('app');
    const list = document.getElementById('conversation-list');
    const deleteDialog = document.getElementById('delete-dialog');
    const deleteTitle = document.getElementById('delete-chat-title');

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
        deleteTitle.textContent = `“${title}”`;
        return new Promise(resolve => {
            deleteDialog.addEventListener('close', () => {
                resolve(deleteDialog.returnValue === 'delete');
            }, { once: true });
            deleteDialog.showModal();
        });
    }

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

    async function loadConversations() {
        const { conversations } = await api('/api/conversations?archived=all');
        document.querySelectorAll('.conversation-menu').forEach(element => element.remove());
        list.replaceChildren();
        if (conversations.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'conversation-empty';
            empty.textContent = 'No conversations yet';
            list.append(empty);
            return;
        }

        for (const conversation of conversations) {
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
                } catch (error) {
                    showConversationError(error);
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
                document.querySelectorAll('.conversation-menu').forEach(element => { element.hidden = true; });
                document.querySelectorAll('.conversation-action[aria-expanded]').forEach(element => {
                    element.setAttribute('aria-expanded', 'false');
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
                }
                if (!opening) menu.hidden = true;
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
                    } catch (error) {
                        showConversationError(error);
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
            list.append(row);
            document.body.append(menu);
        }
    }

    function setMenuOpen(open) {
        appElement.classList.toggle('menu-closed', !open);
        const toggle = document.getElementById('menu-toggle');
        toggle.setAttribute('aria-expanded', String(open));
        toggle.setAttribute('aria-label', open ? 'Collapse menu' : 'Expand menu');
    }

    document.getElementById('new-chat').addEventListener('click', startNewSession);
    document.getElementById('menu-toggle').addEventListener('click', () => {
        setMenuOpen(appElement.classList.contains('menu-closed'));
    });

    const conversationToggle = document.getElementById('conversation-toggle');
    conversationToggle.addEventListener('click', () => {
        const expanded = conversationToggle.getAttribute('aria-expanded') === 'true';
        conversationToggle.setAttribute('aria-expanded', String(!expanded));
        list.hidden = expanded;
    });

    document.addEventListener('click', event => {
        if (event.target.closest('.conversation-row, .conversation-menu')) return;
        document.querySelectorAll('.conversation-menu').forEach(element => { element.hidden = true; });
        document.querySelectorAll('.conversation-action[aria-expanded]').forEach(element => {
            element.setAttribute('aria-expanded', 'false');
        });
    });

    const mobileLayout = window.matchMedia('(max-width: 700px)');
    setMenuOpen(!mobileLayout.matches);
    mobileLayout.addEventListener('change', event => setMenuOpen(!event.matches));

    return { loadConversations };
}