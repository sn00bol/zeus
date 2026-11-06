const SETTINGS_STYLE = `
.settings-dialog {
    width: min(980px, calc(100vw - 32px));
    height: min(700px, calc(100dvh - 32px));
    max-width: none;
    max-height: none;
    padding: 0;
    overflow: hidden;
    border: 1px solid rgba(255, 239, 220, .12);
    border-radius: 18px;
    color: #edf0f7;
    background: #17120f;
    box-shadow: 0 32px 100px #000b, 0 0 0 1px #ffffff08;
}
.settings-dialog::backdrop {
    background: rgba(5, 4, 3, .84);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
}
.settings-shell { width: 100%; height: 100%; min-height: 0; display: grid; grid-template-columns: 230px minmax(0, 1fr); }
.settings-sidebar { min-width: 0; display: flex; flex-direction: column; gap: 4px; padding: 16px 12px; border-right: 1px solid #ffffff0f; background: #120f0d; }
.settings-brand { margin: 0 10px 14px; color: #f8fafc; font-size: 15px; font-weight: 650; letter-spacing: .02em; }
.settings-nav { width: 100%; display: flex; align-items: center; gap: 11px; padding: 10px 11px; border: 1px solid transparent; border-radius: 9px; color: #a7a09a; background: transparent; text-align: left; font: inherit; font-size: 13px; cursor: pointer; transition: background .15s, color .15s, border-color .15s; }
.settings-nav:hover { color: #f5f5f4; background: #ffffff08; }
.settings-nav[aria-current="page"] { color: #ffedd5; border-color: #fb923c28; background: #fb923c12; }
.settings-nav img { width: 16px; height: 16px; flex: none; object-fit: contain; filter: invert(.84); }
.settings-nav[data-section="information"] img { filter: none; }
.sidebar-settings-button { position: absolute; z-index: 23; right: 14px; bottom: 14px; width: 36px; height: 36px; display: grid; place-items: center; padding: 0; border: 0; border-radius: 9px; background: transparent; cursor: pointer; }
.sidebar-settings-button img { width: 18px; height: 18px; object-fit: contain; filter: invert(.84); }
.sidebar-settings-button:hover img { filter: invert(1); }
.sidebar-settings-button:focus-visible { outline: 2px solid #fdba74; outline-offset: 2px; }
.app.menu-closed .sidebar-settings-button { right: 10px; bottom: 12px; width: 36px; height: 36px; }
.settings-main { min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.settings-header { min-height: 62px; display: grid; grid-template-columns: minmax(0, 1fr) minmax(180px, 380px) minmax(0, 1fr); align-items: center; gap: 12px; padding: 10px 18px; border-bottom: 1px solid #ffffff0f; }
.settings-search-wrap { min-width: 0; position: relative; grid-column: 2; }
.settings-search { width: 100%; height: 38px; box-sizing: border-box; padding: 0 14px 0 40px; border: 1px solid #ffffff18; border-radius: 999px; outline: 0; color: #f5f5f4; background: #ffffff06; font: inherit; font-size: 12px; }
.settings-search::placeholder { color: #928a83; }
.settings-search-icon { position: absolute; top: 11px; left: 13px; width: 16px; height: 16px; object-fit: contain; filter: invert(.65); pointer-events: none; }
.settings-search-wrap.search-open .settings-search { border-radius: 19px 19px 0 0; border-bottom-color: transparent; background: #1c1713; }
.settings-search-results { position: absolute; z-index: 2; top: calc(100% - 1px); right: 0; left: 0; display: grid; gap: 3px; max-height: min(320px, 50vh); overflow: auto; padding: 5px; border: 1px solid #ffffff18; border-top: 0; border-radius: 0 0 19px 19px; background: #1c1713; box-shadow: 0 14px 32px #0009; }
.settings-search-results[hidden] { display: none; }
.settings-search-result { width: 100%; padding: 9px 10px; border: 0; border-radius: 6px; color: #e7e5e4; background: transparent; text-align: left; font: inherit; font-size: 12px; cursor: pointer; }
.settings-search-result:hover, .settings-search-result:focus-visible { outline: 0; color: #ffedd5; background: #fb923c16; }
.settings-search-empty { margin: 0; padding: 9px 10px; color: #a8a29e; font-size: 11px; }
.settings-close { width: 34px; height: 34px; flex: none; display: grid; place-items: center; border: 1px solid #ffffff12; border-radius: 9px; color: #a8a29e; background: #ffffff04; font: inherit; font-size: 24px; line-height: 1; cursor: pointer; }
.settings-header > .settings-close { grid-column: 3; justify-self: end; }
.settings-close:hover { color: #fff; background: #ffffff0d; }
.settings-content { min-height: 0; flex: 1; overflow: auto; padding: 16px 20px; }
.settings-page[hidden] { display: none; }
.settings-section-title { margin: 0 0 12px; color: #f5f5f4; font-size: 18px; font-weight: 600; }
.settings-description { margin: 0; color: #928a83; font-size: 12px; line-height: 1.6; }
.settings-model-panel { padding: 0; }
.settings-model-panel-heading-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.settings-model-panel-heading-row .settings-section-title { margin: 0; }
.settings-catalog-refresh { width: 28px; height: 28px; display: grid; place-items: center; padding: 0; border: 0; border-radius: 6px; color: #a8a29e; background: transparent; cursor: pointer; }
.settings-catalog-refresh:hover:not(:disabled) { color: #ffedd5; }
.settings-catalog-refresh img { width: 16px; height: 16px; object-fit: contain; filter: invert(.72); }
.settings-catalog-refresh:hover:not(:disabled) img { filter: invert(1); }
.settings-catalog-refresh:disabled { opacity: .55; cursor: wait; }
.settings-model-list { display: grid; gap: 8px; margin-top: 10px; }
.settings-model-card { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 10px 12px; border: 1px solid #ffffff10; border-radius: 10px; background: #ffffff03; }
.settings-model-card-name { min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; overflow-wrap: anywhere; color: #f5f5f4; font-size: 12px; font-weight: 550; }
.settings-provider-icon { width: 15px; height: 15px; flex: none; object-fit: contain; filter: invert(.82); }
.settings-model-card-detail { margin-top: 5px; overflow-wrap: anywhere; color: #928a83; font-size: 10px; }
.settings-model-badge { display: inline-flex; align-items: center; min-height: 19px; padding: 0 6px; border: 1px solid #ffffff12; border-radius: 999px; color: #b7b0aa; background: #ffffff06; font: inherit; font-size: 9px; }
.settings-model-badge[data-supported="true"] { border-color: #fb923c44; color: #ffedd5; background: #fb923c12; }
.settings-model-badge[data-supported="false"] { color: #78716c; text-decoration: line-through; }
.settings-model-card-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 7px; }
.settings-action-disabled { border-color: #fb718566; color: #fecdd3; background: #be123c30; }
.settings-action-disabled:hover:not(:disabled) { border-color: #fb7185aa; background: #be123c55; }
.settings-empty { margin: 0; color: #928a83; font-size: 11px; line-height: 1.5; }
.settings-action { min-height: 38px; padding: 0 13px; border: 1px solid #ffffff17; border-radius: 9px; color: #e7e5e4; background: #ffffff08; font: inherit; font-size: 12px; cursor: pointer; }
.settings-action:hover:not(:disabled) { border-color: #fb923c55; background: #fb923c12; }
.settings-action:disabled { opacity: .55; cursor: wait; }
.settings-status { min-height: 20px; margin: 12px 0 0; color: #a8a29e; font-size: 11px; line-height: 1.5; }
.settings-status[data-error="true"] { color: #fda4af; }
.settings-toggle-row { min-height: 56px; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 10px 0; border-bottom: 1px solid #ffffff0e; }
.settings-toggle-copy { min-width: 0; display: grid; gap: 5px; }
.settings-toggle-title { color: #e7e5e4; font-size: 13px; font-weight: 500; }
.settings-toggle-description { color: #928a83; font-size: 11px; line-height: 1.5; }
.settings-switch { width: 40px; height: 23px; position: relative; flex: none; border: 1px solid #ffffff20; border-radius: 999px; padding: 0; background: #ffffff12; cursor: pointer; transition: background .16s, border-color .16s; }
.settings-switch::after { position: absolute; top: 3px; left: 3px; width: 15px; height: 15px; border-radius: 50%; background: #b7b0aa; content: ""; transition: transform .16s, background .16s; }
.settings-switch[aria-checked="true"] { border-color: #fb923c99; background: #fb923c80; }
.settings-switch[aria-checked="true"]::after { transform: translateX(17px); background: #fff7ed; }
.settings-switch:focus-visible, .settings-close:focus-visible, .settings-action:focus-visible, .settings-catalog-refresh:focus-visible, .settings-nav:focus-visible { outline: 2px solid #fdba74; outline-offset: 2px; }
body.compact-ui .composer { padding-top: 7px; padding-bottom: 7px; }
body.compact-ui .conversation-item { padding-top: 6px; padding-bottom: 6px; }
body.reduce-motion *, body.reduce-motion *::before, body.reduce-motion *::after { scroll-behavior: auto !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
@media (max-width: 620px) {
    .settings-dialog { width: calc(100vw - 18px); height: min(720px, calc(100dvh - 18px)); border-radius: 13px; }
    .settings-shell { grid-template-columns: 142px minmax(0, 1fr); }
    .settings-sidebar { padding: 14px 8px; }
    .settings-brand { margin: 0 8px 12px; font-size: 13px; }
    .settings-nav { gap: 7px; padding: 9px 7px; font-size: 11px; }
    .settings-nav img { width: 14px; height: 14px; }
    .settings-header { min-height: 58px; grid-template-columns: minmax(0, 1fr) minmax(34px, auto); padding: 9px 12px; }
    .settings-search-wrap { grid-column: 1; }
    .settings-header > .settings-close { grid-column: 2; }
    .settings-content { padding: 14px 12px; }
    .settings-model-card { grid-template-columns: minmax(0, 1fr); }
    .settings-model-card-actions { justify-content: flex-start; }
}
@media (max-width: 380px) {
    .settings-shell { grid-template-columns: 116px minmax(0, 1fr); }
    .settings-nav { gap: 5px; font-size: 10px; }
}
`;

const SECTIONS = [
    { id: 'models', label: 'Model Manager', icon: '/icon/model.png' },
    { id: 'search', label: 'Search', icon: '/icon/search.png' },
    { id: 'appearance', label: 'Appearance', icon: '/icon/appearance.png' },
    { id: 'shortcuts', label: 'Shortcut', icon: '/icon/shortcut.png' },
    { id: 'information', label: 'Information', icon: '/icon/info.png' },
];

const SETTINGS_SEARCH_ITEMS = [
    { label: 'Model Manager', keywords: 'models model catalog provider', section: 'models', target: '.settings-catalog-refresh' },
    { label: 'Refresh model list', keywords: 'models model catalog refresh reload', section: 'models', target: '.settings-catalog-refresh' },
    { label: 'Show the @search tool', keywords: 'search web tool composer', section: 'search', target: '[data-setting="search"]' },
    { label: 'Compact interface', keywords: 'appearance compact spacing', section: 'appearance', target: '[data-setting="compact"]' },
    { label: 'Reduce motion', keywords: 'appearance animation transition', section: 'appearance', target: '[data-setting="motion"]' },
    { label: 'Shortcut', keywords: 'keyboard keys shortcut', section: 'shortcuts' },
    { label: 'Information', keywords: 'about version information', section: 'information' },
];

function readPreference(key, fallback) {
    try {
        const value = localStorage.getItem(key);
        return value === null ? fallback : value === 'true';
    } catch (error) {
        console.warn(`[WEBUI] Could not read setting ${key}:`, error);
        return fallback;
    }
}

function writePreference(key, value) {
    try {
        localStorage.setItem(key, String(value));
    } catch (error) {
        console.warn(`[WEBUI] Could not save setting ${key}:`, error);
    }
}

export function initializeSettings({
    getConversationId,
    loadModels,
    onSearchSettingChange,
}) {
    const style = document.createElement('style');
    style.textContent = SETTINGS_STYLE;
    document.head.append(style);

    const template = document.createElement('template');
    template.innerHTML = `
        <dialog class="settings-dialog" id="settings-dialog" aria-label="Settings">
            <div class="settings-shell">
                <nav class="settings-sidebar" aria-label="Settings sections">
                    <div class="settings-brand">Settings</div>
                    ${SECTIONS.map((section, index) => `
                        <button class="settings-nav" type="button" data-section="${section.id}"
                            aria-current="${index === 0 ? 'page' : 'false'}">
                            <img src="${section.icon}" alt="">
                            <span>${section.label}</span>
                        </button>
                    `).join('')}
                </nav>
                <section class="settings-main">
                    <header class="settings-header">
                        <div class="settings-search-wrap">
                            <img class="settings-search-icon" src="/icon/search.png" alt="">
                            <input class="settings-search" type="search" placeholder="Search settings..."
                                aria-label="Search settings" aria-controls="settings-search-results"
                                aria-expanded="false" autocomplete="off">
                            <div class="settings-search-results" id="settings-search-results"
                                role="listbox" hidden></div>
                        </div>
                        <button class="settings-close" type="button" aria-label="Close settings">
                            <span aria-hidden="true">×</span>
                        </button>
                    </header>
                    <div class="settings-content">
                        <section class="settings-page" data-page="models">
                            <section class="settings-model-panel">
                                <div class="settings-model-panel-heading-row">
                                    <h2 class="settings-section-title">Model Manager</h2>
                                    <button class="settings-catalog-refresh" type="button"
                                        aria-label="Refresh model list" title="Refresh model list">
                                        <img src="/icon/refresh.png" alt="">
                                    </button>
                                </div>
                                <div class="settings-model-list" aria-live="polite"></div>
                            </section>
                        </section>
                        <section class="settings-page" data-page="search" hidden>
                            <h2 class="settings-section-title">Search</h2>
                            <p class="settings-description">Manage search tools available while composing a message.</p>
                            <div class="settings-toggle-row">
                                <div class="settings-toggle-copy">
                                    <span class="settings-toggle-title">Show the @search tool</span>
                                    <span class="settings-toggle-description">Allow selecting web search from the message composer. Automatic search behavior is unchanged.</span>
                                </div>
                                <button class="settings-switch" type="button" role="switch"
                                    aria-label="Show the search tool" aria-checked="true" data-setting="search"></button>
                            </div>
                        </section>
                        <section class="settings-page" data-page="appearance" hidden>
                            <h2 class="settings-section-title">Appearance</h2>
                            <p class="settings-description">Adjust the interface to your preference. Changes are saved in this browser.</p>
                            <div class="settings-toggle-row">
                                <div class="settings-toggle-copy">
                                    <span class="settings-toggle-title">Compact interface</span>
                                    <span class="settings-toggle-description">Reduce spacing in the composer and conversation list.</span>
                                </div>
                                <button class="settings-switch" type="button" role="switch"
                                    aria-label="Compact interface" aria-checked="false" data-setting="compact"></button>
                            </div>
                            <div class="settings-toggle-row">
                                <div class="settings-toggle-copy">
                                    <span class="settings-toggle-title">Reduce motion</span>
                                    <span class="settings-toggle-description">Minimize interface animations and transitions.</span>
                                </div>
                                <button class="settings-switch" type="button" role="switch"
                                    aria-label="Reduce motion" aria-checked="false" data-setting="motion"></button>
                            </div>
                        </section>
                        <section class="settings-page" data-page="shortcuts" hidden>
                            <h2 class="settings-section-title">Shortcut</h2>
                        </section>
                        <section class="settings-page" data-page="information" hidden>
                            <h2 class="settings-section-title">Information</h2>
                        </section>
                    </div>
                </section>
            </div>
        </dialog>
    `;
    document.body.append(template.content);

    const dialog = document.getElementById('settings-dialog');
    const openButton = document.getElementById('settings-open-button');
    const closeButton = dialog.querySelector('.settings-close');
    const modelList = dialog.querySelector('.settings-model-list');
    const catalogRefreshButton = dialog.querySelector('.settings-catalog-refresh');
    const settingsSearch = dialog.querySelector('.settings-search');
    const searchResults = dialog.querySelector('.settings-search-results');
    let catalogModels = [];
    let searchEnabled = readPreference('zeus.webui.search_tool', true);
    const preferences = {
        compact: readPreference('zeus.webui.compact', false),
        motion: readPreference('zeus.webui.reduce_motion', false),
    };

    function setToggle(button, checked) {
        button.setAttribute('aria-checked', String(checked));
    }

    function applyAppearance() {
        document.body.classList.toggle('compact-ui', preferences.compact);
        document.body.classList.toggle('reduce-motion', preferences.motion);
    }

    async function requestModelManager(path, options = {}) {
        const response = await fetch(path, {
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

    function renderModelCatalog() {
        modelList.replaceChildren();
        if (!catalogModels.length) {
            const empty = document.createElement('p');
            empty.className = 'settings-empty';
            empty.textContent = 'No local models are currently detected. Check that a provider is running, then refresh.';
            modelList.append(empty);
            return;
        }
        for (const model of catalogModels) {
            const card = document.createElement('article');
            card.className = 'settings-model-card';
            const copy = document.createElement('div');
            const name = document.createElement('div');
            name.className = 'settings-model-card-name';
            const providerIconPaths = {
                ollama: '/icon/ollama.png',
                lmstudio: '/icon/lmstudio.png',
                llamacpp: '/icon/llama-cpp.png',
            };
            const providerIcon = document.createElement('img');
            providerIcon.className = 'settings-provider-icon';
            providerIcon.src = providerIconPaths[model.provider] || '/icon/model.png';
            providerIcon.alt = model.provider_name || model.provider;
            name.append(providerIcon);
            const modelTitle = document.createElement('span');
            modelTitle.textContent = model.model;
            name.append(modelTitle);
            for (const [key, label] of [
                ['supportsVision', 'Vision'],
                ['supportsThinking', 'Thinking'],
            ]) {
                const supported = model[key] ?? model[
                    key === 'supportsVision' ? 'supports_vision' : 'supports_thinking'
                ] ?? false;
                const badge = document.createElement('span');
                badge.className = 'settings-model-badge';
                badge.dataset.supported = String(supported);
                badge.setAttribute('aria-label', `${label}: ${supported ? 'supported' : 'not supported'}`);
                badge.textContent = label;
                name.append(badge);
            }
            const detail = document.createElement('div');
            detail.className = 'settings-model-card-detail';
            detail.textContent = model.baseUrl || model.base_url || '';
            copy.append(name, detail);
            const actions = document.createElement('div');
            actions.className = 'settings-model-card-actions';
            const toggle = document.createElement('button');
            toggle.className = `settings-action${model.enabled ? '' : ' settings-action-disabled'}`;
            toggle.type = 'button';
            toggle.textContent = model.enabled ? 'Disable' : 'Enable';
            toggle.setAttribute('aria-pressed', String(!model.enabled));
            toggle.addEventListener('click', () => void updateModelControl(model, {
                enabled: !model.enabled,
            }));
            actions.append(toggle);
            card.append(copy, actions);
            modelList.append(card);
        }
    }

    async function loadModelCatalog() {
        const result = await requestModelManager('/api/model-catalog');
        catalogModels = Array.isArray(result.models) ? result.models : [];
        renderModelCatalog();
    }

    async function refreshModelData() {
        await Promise.all([
            loadModels(getConversationId()),
            loadModelCatalog(),
        ]);
    }

    async function updateModelControl(model, changes) {
        try {
            const route = `/api/model-catalog/${encodeURIComponent(model.provider)}/${encodeURIComponent(model.model)}`;
            await requestModelManager(route, {
                method: 'PATCH',
                body: JSON.stringify(changes),
            });
            await refreshModelData();
        } catch (error) {
            window.alert(`Could not update model: ${error.message}`);
        }
    }

    function activateSection(sectionId) {
        const section = SECTIONS.find(item => item.id === sectionId);
        if (!section) return;
        for (const button of dialog.querySelectorAll('.settings-nav')) {
            button.setAttribute('aria-current', String(button.dataset.section === sectionId ? 'page' : 'false'));
        }
        for (const page of dialog.querySelectorAll('.settings-page')) {
            page.hidden = page.dataset.page !== sectionId;
        }
    }

    function closeSearchResults() {
        searchResults.hidden = true;
        settingsSearch.setAttribute('aria-expanded', 'false');
        settingsSearch.parentElement.classList.remove('search-open');
    }

    function renderSearchResults(query) {
        const normalized = query.trim().toLocaleLowerCase();
        searchResults.replaceChildren();
        if (!normalized) {
            closeSearchResults();
            return;
        }
        const matches = SETTINGS_SEARCH_ITEMS.filter(item => (
            `${item.label} ${item.keywords}`.toLocaleLowerCase().includes(normalized)
        ));
        if (!matches.length) {
            const empty = document.createElement('p');
            empty.className = 'settings-search-empty';
            empty.textContent = 'No matching settings.';
            searchResults.append(empty);
        } else {
            for (const item of matches) {
                const result = document.createElement('button');
                result.className = 'settings-search-result';
                result.type = 'button';
                result.setAttribute('role', 'option');
                result.textContent = item.label;
                result.addEventListener('click', () => {
                    activateSection(item.section);
                    closeSearchResults();
                    settingsSearch.value = '';
                    const target = item.target && dialog.querySelector(item.target);
                    target?.focus();
                });
                searchResults.append(result);
            }
        }
        searchResults.hidden = false;
        settingsSearch.setAttribute('aria-expanded', 'true');
        settingsSearch.parentElement.classList.add('search-open');
    }

    settingsSearch.addEventListener('input', () => renderSearchResults(settingsSearch.value));
    settingsSearch.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            event.preventDefault();
            closeSearchResults();
            settingsSearch.value = '';
            return;
        }
        if (event.key === 'Enter' && !searchResults.hidden) {
            const firstResult = searchResults.querySelector('.settings-search-result');
            if (firstResult) {
                event.preventDefault();
                firstResult.click();
            }
        }
    });
    dialog.addEventListener('click', event => {
        if (!searchResults.contains(event.target) && event.target !== settingsSearch) {
            closeSearchResults();
        }
    });

    for (const button of dialog.querySelectorAll('.settings-nav')) {
        button.addEventListener('click', () => activateSection(button.dataset.section));
    }
    openButton?.addEventListener('click', () => {
        dialog.showModal();
        activateSection('models');
        void refreshModelData().catch(error => (
            window.alert(`Could not load model catalog: ${error.message}`)
        ));
    });
    closeButton.addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => {
        if (event.target === dialog) dialog.close();
    });
    catalogRefreshButton.addEventListener('click', async () => {
        catalogRefreshButton.disabled = true;
        try {
            await refreshModelData();
        } catch (error) {
            window.alert(`Could not refresh model list: ${error.message}`);
        } finally {
            catalogRefreshButton.disabled = false;
        }
    });
    const searchToggle = dialog.querySelector('[data-setting="search"]');
    setToggle(searchToggle, searchEnabled);
    searchToggle.addEventListener('click', () => {
        searchEnabled = !searchEnabled;
        setToggle(searchToggle, searchEnabled);
        writePreference('zeus.webui.search_tool', searchEnabled);
        onSearchSettingChange(searchEnabled);
    });

    for (const button of dialog.querySelectorAll('[data-setting="compact"], [data-setting="motion"]')) {
        const key = button.dataset.setting;
        setToggle(button, preferences[key]);
        button.addEventListener('click', () => {
            preferences[key] = !preferences[key];
            setToggle(button, preferences[key]);
            writePreference(key === 'compact' ? 'zeus.webui.compact' : 'zeus.webui.reduce_motion', preferences[key]);
            applyAppearance();
        });
    }
    applyAppearance();

    return {
        isSearchEnabled: () => searchEnabled,
    };
}
