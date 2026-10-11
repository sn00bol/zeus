const themeStyles = String.raw`
:root {
            color-scheme: dark;
            font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            background: #100d0b;
            color: #edf0f7;
            font-synthesis: none;
            text-rendering: optimizeLegibility;
            --muted: #a1978d;
            --line: rgba(255, 239, 220, .09);
            --surface: #191410;
            --accent: #fb923c;
        }
        * { box-sizing: border-box; }
        body { margin: 0; min-width: 320px; height: 100vh; overflow: hidden; }
        button, textarea { font: inherit; }
        .app { height: 100vh; height: 100dvh; overflow: hidden; }
        .sidebar { position: fixed; z-index: 20; inset: 0 auto 0 0; width: 250px; height: 100vh; height: 100dvh; overflow: visible; background: #15110e; border-right: 1px solid var(--line); transition: width .22s ease; }
        .menubar { position: relative; z-index: 22; width: 100%; height: 66px; flex: none; padding: 0 17px; display: flex; align-items: center; background: #15110e; }
        .menubar-brand { position: absolute; left: 17px; width: 88px; height: 34px; display: grid; place-items: center; padding: 0; border: 0; background: transparent; cursor: pointer; opacity: 1; transform: translateX(0); transition: opacity .14s ease, transform .2s ease; }
        .menubar-brand img { display: block; width: 100%; height: auto; }
        .menu-toggle { position: absolute; right: 17px; width: 34px; height: 34px; display: grid; place-items: center; border: 1px solid var(--line); border-radius: 9px; color: #d4d8e2; background: transparent; cursor: pointer; transition: right .22s ease; }
        .menu-toggle:hover { background: #ffffff0a; }
        .sidebar-content { position: absolute; inset: 66px auto 0 0; width: 250px; overflow: hidden; padding: 10px 12px 14px; display: flex; flex-direction: column; gap: 14px; opacity: 1; transform: translateX(0); transition: opacity .14s ease .06s, transform .22s ease; }
        .app.menu-closed .sidebar { width: 56px; }
        .app.menu-closed .menubar-brand { opacity: 0; transform: translateX(-8px); pointer-events: none; }
        .app.menu-closed .menu-toggle { right: 11px; }
        .app.menu-closed .sidebar-content { opacity: 0; transform: translateX(-12px); pointer-events: none; transition: opacity .1s ease, transform .22s ease; }
        .new-chat { width: 100%; display: flex; align-items: center; gap: 8px; border: 0; border-radius: 8px; color: #cbd5e1; background: transparent; padding: 6px 10px; font-size: 13px; font-weight: 500; cursor: pointer; transition: background .15s, color .15s; }
        .new-chat:hover { background: #ffffff0c; color: #fff; }
        .conversation-section { min-height: 0; flex: 1; display: flex; flex-direction: column; gap: 6px; }
        .conversation-section[hidden] { display: none; }
        #pinned-section { flex: none; }
        #pinned-list { max-height: 30vh; flex: none; }
        .side-label { width: 100%; flex: none; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 5px 7px; border: 0; border-radius: 7px; color: #a3aaba; background: transparent; text-align: left; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
        .side-label:hover { color: #edf0f7; background: #ffffff08; }
        .conversation-toggle-icon { flex: none; color: #818b9d; transition: transform .18s ease; }
        .side-label[aria-expanded="false"] .conversation-toggle-icon { transform: rotate(-90deg); }
        .conversation-list { min-height: 0; flex: 1; display: flex; flex-direction: column; gap: 5px; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: #444b5a transparent; }
        .conversation-list[hidden] { display: none; }
        .conversation-row { position: relative; display: flex; align-items: center; gap: 3px; border: 1px solid transparent; border-radius: 9px; }
        .conversation-row:hover, .conversation-row:focus-within, .conversation-row[aria-current="page"] { border-color: var(--line); background: #ffffff08; }
        .conversation-row.rename-active, .conversation-row.rename-active:hover, .conversation-row.rename-active:focus-within, .conversation-row.rename-active[aria-current="page"] { border-color: transparent; background: transparent; }
        .conversation-item { min-width: 0; flex: 1; overflow: hidden; text-align: left; text-overflow: ellipsis; white-space: nowrap; border: 0; border-radius: 8px; padding: 9px 8px 9px 10px; color: #a3aaba; background: transparent; font-size: 12px; cursor: pointer; }
        .conversation-row:hover .conversation-item, .conversation-row:focus-within .conversation-item { color: #e5e7eb; }
        .conversation-rename-form { position: relative; min-width: 0; flex: 1; display: flex; align-items: center; padding: 4px; }
        .conversation-rename-input { min-width: 0; flex: 1; border: 1px solid #fb923c66; border-radius: 6px; outline: 0; padding: 6px 7px; color: #edf0f7; background: transparent; font: inherit; font-size: 11px; }
        .conversation-rename-input:disabled { opacity: .6; }
        .conversation-rename-error { position: absolute; top: calc(100% + 2px); left: 8px; z-index: 2; max-width: calc(100% - 16px); color: #fda4af; font-size: 10px; }
        .conversation-actions { display: flex; align-items: center; padding-right: 4px; opacity: 0; transition: opacity .12s; }
        .conversation-row:hover .conversation-actions, .conversation-row:focus-within .conversation-actions { opacity: 1; }
        .conversation-action { width: 27px; height: 27px; display: grid; place-items: center; border: 0; border-radius: 7px; color: #8e98aa; background: transparent; font-size: 15px; cursor: pointer; }
        .conversation-action:hover, .conversation-action[aria-pressed="true"] { color: #fed7aa; background: #ffffff0d; }
        .conversation-menu { position: fixed; z-index: 30; width: 150px; padding: 5px; border: 1px solid #ffffff18; border-radius: 10px; background: #211912; box-shadow: 0 12px 30px #0008; }
        .conversation-menu[hidden] { display: none; }
        .conversation-menu button { width: 100%; display: block; padding: 8px 9px; text-align: left; border: 0; border-radius: 6px; color: #c4cad5; background: transparent; font-size: 11px; cursor: pointer; }
        .conversation-menu button:hover { background: #ffffff0d; color: #fff; }
        .conversation-menu button.danger { color: #fda4af; }
        .archive-toggle { width: 100%; display: flex; align-items: center; gap: 8px; padding: 5px; border: 0; color: #818b9d; background: transparent; text-align: left; font-size: 11px; cursor: pointer; }
        .archive-toggle:hover { color: #d4d8e2; }
        .conversation-empty { color: #727c8f; font-size: 11px; padding: 4px 5px; }
        .history-note { display: flex; align-items: flex-start; gap: 10px; color: #a3aaba; font-size: 12px; line-height: 1.6; padding: 12px 9px; border: 1px solid var(--line); border-radius: 10px; background: #ffffff04; }
        .history-note svg { flex: none; margin-top: 1px; color: #fb923c; }
        .side-bottom { margin-top: auto; border-top: 1px solid var(--line); padding: 16px 5px 0; color: #727c8f; font-size: 11px; line-height: 1.6; }
        .main { width: calc(100% - 250px); height: 100vh; height: 100dvh; min-width: 0; margin-left: 250px; display: flex; flex-direction: column; transition: margin-left .22s ease, width .22s ease; }
        .app.menu-closed .main { width: calc(100% - 56px); margin-left: 56px; }
        .chat { position: relative; width: 100%; min-height: 0; margin: 0; padding: 20px clamp(18px, 3vw, 48px) 12px; flex: 1; display: flex; flex-direction: column; }
        .chat-scroll { position: relative; min-height: 0; flex: 1; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; scrollbar-width: thin; scrollbar-color: #444b5a transparent; }
        .chat-content { width: min(100%, 920px); min-height: 100%; margin-inline: auto; display: flex; flex-direction: column; }
        .welcome-stage { display: none; }
        .chat.welcome-state .chat-scroll { overflow: hidden; }
        .chat.welcome-state .chat-content { height: 100%; }
        .chat.welcome-state .welcome-stage { min-height: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center; }
        .chat.welcome-state .welcome { flex: none; margin: 0 auto 20px; padding: 0; }
        .chat.welcome-state .composer-wrap { flex: none; margin: 0 auto; padding: 0 0 5px; }
        .chat.welcome-state .footer { flex: none; }
        .chat.welcome-state .history-loading { position: absolute; inset: 0; z-index: 1; min-height: 0; }
        .chat-dock { width: min(100%, 920px); flex: none; margin-inline: auto; }
        .chat-dock[hidden] { display: none; }
        .delete-dialog { width: min(440px, calc(100vw - 32px)); border: 1px solid #ffffff1a; border-radius: 16px; padding: 0; color: #edf0f7; background: #211912; box-shadow: 0 24px 80px #000b; }
        .delete-dialog::backdrop { background: #05070bb8; backdrop-filter: blur(3px); }
        .delete-dialog form { padding: 24px; }
        .delete-dialog h2 { margin: 0; font-size: 18px; letter-spacing: -.02em; }
        .delete-dialog p { margin: 12px 0 22px; color: #a3aaba; font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; }
        .delete-dialog strong { color: #e5e7eb; }
        .delete-dialog-actions { display: flex; justify-content: flex-end; gap: 9px; }
        .delete-dialog-actions button { border: 1px solid #ffffff18; border-radius: 8px; padding: 8px 12px; color: #d5d9e2; background: #ffffff08; font: inherit; font-size: 12px; cursor: pointer; }
        .delete-dialog-actions button:hover { background: #ffffff12; }
        .delete-dialog-actions .dialog-delete { border-color: #fb718555; color: #fff; background: #be394a; }
        .delete-dialog-actions .dialog-delete:hover { background: #d24759; }
        .history-loading { min-height: 50vh; display: grid; place-items: center; color: var(--muted); font-size: 13px; }
        .history-loading[hidden] { display: none; }
        .welcome { text-align: center; margin: auto auto 28px; max-width: 510px; padding-top: 5vh; }
        .welcome-icon { width: 56px; height: 56px; margin: 0 auto 18px; border: 1px solid #fb923c35; border-radius: 18px; display: grid; place-items: center; color: #fdba74; background: radial-gradient(circle at top left, #fb923c22, #fb923c08); }
        h1 { margin: 0; font-size: clamp(25px, 4vw, 34px); letter-spacing: -.04em; }
        .welcome p { margin: 11px auto 0; color: var(--muted); font-size: 14px; line-height: 1.7; }
        .messages { display: flex; flex-direction: column; gap: 22px; padding: 24px 0 28px; }
        .message { display: flex; align-items: flex-start; animation: appear .22s ease-out; }
        @keyframes appear { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
        .message-body { min-width: 0; max-width: 100%; padding-top: 1px; }
        .message.user { justify-content: flex-end; }
        .message.user .message-body { max-width: min(78%, 620px); padding: 11px 15px; border: 1px solid #fb923c2b; border-radius: 16px 16px 4px 16px; background: linear-gradient(145deg, #fb923c20, #ffffff08); color: #fff7ed; }
        .message-content { color: #e4e7ee; font-size: 14px; line-height: 1.75; overflow-wrap: anywhere; }
        .message.user .message-content { color: #fff7ed; white-space: pre-wrap; }
        .message-content > :first-child { margin-top: 0; }
        .message-content > :last-child { margin-bottom: 0; }
        .message-content p { margin: 0 0 12px; white-space: pre-wrap; }
        .message-content h1, .message-content h2, .message-content h3 { margin: 18px 0 8px; line-height: 1.35; letter-spacing: -.02em; }
        .message-content h1 { font-size: 1.35em; }
        .message-content h2 { font-size: 1.2em; }
        .message-content h3 { font-size: 1.08em; }
        .message-content h4, .message-content h5, .message-content h6 { font-size: 1em; margin: 14px 0 6px; color: #cbd5e1; }
        .message-content ul, .message-content ol { margin: 8px 0 14px; padding-left: 23px; }
        .message-content li { padding-left: 3px; margin: 3px 0; }
        .message-content a { color: #fdba74; text-decoration: underline; text-underline-offset: 3px; }
        .message-content p code, .message-content li code, .inline-code { border: 1px solid #ffffff12; border-radius: 5px; padding: 2px 5px; color: #ffedd5; background: #ffffff0b; font: .9em ui-monospace, SFMono-Regular, Consolas, monospace; }
        .message-content pre { position: relative; margin: 12px 0 16px; overflow: hidden; border: 1px solid #ffffff13; border-radius: 11px; background: #090c12; }
        .message-content pre code { display: block; overflow: auto; padding: 13px 15px 16px; color: #d5d9e3; font: 12px/1.7 ui-monospace, SFMono-Regular, Consolas, monospace; white-space: pre; }
        
        /* Syntax Highlighting */
        .tok-kw { color: #fb923c; font-weight: 600; }
        .tok-str { color: #86efac; }
        .tok-num { color: #f472b6; }
        .tok-com { color: #64748b; font-style: italic; }
        .tok-builtin { color: #67e8f9; }
        .tok-fn { color: #38bdf8; }
        .tok-tag { color: #fb7185; }

        /* Tables */
        .table-wrapper { overflow-x: auto; margin: 14px 0; border: 1px solid #ffffff14; border-radius: 9px; background: #15110e; }
        .markdown-table { width: 100%; border-collapse: collapse; font-size: 13px; text-align: left; }
        .markdown-table th { background: #1d1712; padding: 9px 13px; border-bottom: 1px solid #ffffff16; font-weight: 600; color: #f1f5f9; white-space: nowrap; }
        .markdown-table td { padding: 8px 13px; border-bottom: 1px solid #ffffff08; color: #cbd5e1; }
        .markdown-table tr:last-child td { border-bottom: 0; }
        .markdown-table tr:hover td { background: #ffffff04; }

        /* Task lists */
        .task-list { list-style: none; padding-left: 2px; margin: 8px 0; }
        .task-item { display: flex; align-items: baseline; gap: 8px; margin: 4px 0; }
        .task-item input[type="checkbox"] { accent-color: #fb923c; margin: 0; transform: translateY(1px); }

        /* Blockquotes */
        .message-content blockquote { margin: 12px 0; padding: 6px 14px; border-left: 3px solid #fb923c88; background: #ffffff05; border-radius: 0 8px 8px 0; color: #b4a89c; }
        .message-content blockquote p { margin: 0; }
        
        /* Math */
        .math-block-container { display: flex; justify-content: center; margin: 14px 0; overflow-x: auto; }
        .math-block { display: inline-block; padding: 7px 16px; background: #100d0b; border: 1px solid #fb923c25; border-radius: 8px; font-family: "Cambria Math", "Latin Modern Math", serif; font-size: 1.15em; color: #e2e8f0; font-style: italic; letter-spacing: .02em; }
        .math-inline { display: inline; font-family: "Cambria Math", "Latin Modern Math", serif; font-size: 1.05em; color: #e2e8f0; font-style: italic; }

        /* Horizontal rule & Strikethrough */
        .markdown-hr { border: 0; height: 1px; background: #ffffff14; margin: 18px 0; }
        .message-content del { color: #94a3b8; text-decoration: line-through; }
        .message-content mark { background: #fef08a26; color: #fef08a; padding: 1px 3px; border-radius: 3px; }

        .code-toolbar { display: flex; align-items: center; justify-content: space-between; padding: 7px 10px; border-bottom: 1px solid #ffffff10; color: #858da0; background: #ffffff04; font-size: 10px; }
        .code-copy { border: 1px solid #ffffff13; border-radius: 6px; padding: 4px 8px; color: #b8bfce; background: #ffffff08; font-size: 10px; cursor: pointer; transition: background .15s; }
        .code-copy:hover { color: #fff; background: #ffffff12; }
        .stream-details { display: flex; flex-wrap: wrap; gap: 7px 12px; margin-top: 9px; color: #778195; font-size: 10px; }
        .source-pills { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
        .source-pill { display: inline-flex; align-items: center; gap: 5px; max-width: 150px; padding: 3px 7px; overflow: hidden; border: 1px solid #ffffff16; border-radius: 999px; color: #a7b0c0; background: #ffffff06; text-decoration: none; white-space: nowrap; transition: border-color .15s, color .15s, background .15s; }
        .source-pill:hover { border-color: #fb923c55; color: #fed7aa; background: #fb923c0c; }
        .source-pill svg { width: 12px; height: 12px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.25; }
        .source-pill span { overflow: hidden; text-overflow: ellipsis; }
        .message.error .message-content { color: #fda4af; }
        .loading-state { display: grid; gap: 8px; min-height: 26px; color: #aeb5c3; font-size: 13px; }
        .loading-row { display: inline-flex; align-items: center; gap: 10px; min-height: 26px; cursor: pointer; user-select: none; }
        .loading-spinner { width: 16px; height: 16px; flex: none; border: 2px solid #fb923c35; border-top-color: #fdba74; border-radius: 50%; animation: spin .75s linear infinite; }
        .thinking-icon { display: flex; align-items: center; color: #fb923c; }
        .thinking-toggle { width: 26px; height: 26px; display: grid; place-items: center; border: 1px solid #ffffff14; border-radius: 7px; color: #9aa3b5; background: #ffffff08; cursor: pointer; }
        .thinking-toggle:hover { color: #ffedd5; border-color: #fb923c66; background: #ffffff10; }
        .thinking-toggle svg { display: block; transition: transform .18s ease; }
        .loading-state.thinking-open .thinking-toggle svg { transform: rotate(180deg); }
        .thinking-panel { max-height: 320px; overflow: auto; border: 1px solid #ffffff12; border-radius: 10px; padding: 10px 12px; background: #15110e; box-shadow: inset 0 2px 6px #0004; }
        .thinking-text { margin: 0; color: #9aa3b5; font: 12px/1.65 ui-monospace, SFMono-Regular, Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
        .loading-state.thinking-finished .loading-label { color: #8b93a5; font-size: 12px; }
        .loading-state.thinking-finished .loading-row:hover .loading-label { color: #cbd5e1; }
        .message-thinking { margin-bottom: 10px; }
        .source-footer { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: start; gap: 7px 10px; flex: 1 0 100%; padding-top: 8px; border-top: 1px solid #ffffff0c; }
        .source-footer-label { padding-top: 4px; color: #a0a8b8; font-size: 10px; }
        .source-footer .source-pills { gap: 6px; }
        .source-footer .source-pill { max-width: 220px; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .composer-wrap { width: min(100%, 920px); flex: none; margin-inline: auto; padding: 12px 0 5px; }
        .composer { width: 100%; display: flex; align-items: flex-end; gap: 10px; position: relative; border: 1px solid #ffffff17; border-radius: 16px; padding: 8px 9px 8px 16px; background: #1b1612; box-shadow: 0 12px 40px #0003; transition: border-color .2s; }
        .composer:focus-within { border-color: #fb923c80; }
        .composer.multiline { flex-direction: column; align-items: stretch; gap: 4px; }
        .composer.multiline textarea { flex: none; width: 100%; }
        .composer.has-tools { flex-direction: column; align-items: stretch; gap: 4px; }
        .composer.has-tools textarea { flex: none; width: 100%; }
        .composer-actions { display: flex; align-items: center; gap: 8px; flex: none; }
        .composer.multiline .composer-actions, .composer.has-tools .composer-actions { align-self: flex-end; }
        .tool-picker-menu { position: absolute; z-index: 13; left: 8px; bottom: calc(100% + 7px); width: min(340px, 85vw); max-height: 280px; overflow: auto; padding: 6px; border: 1px solid #ffffff18; border-radius: 11px; background: #211912; box-shadow: 0 14px 32px #0009; }
        .tool-picker-menu[hidden] { display: none; }
        .tool-option { width: 100%; display: grid; gap: 4px; padding: 9px; border: 0; border-radius: 7px; color: #c4cad5; background: transparent; text-align: left; cursor: pointer; }
        .tool-option:hover, .tool-option[aria-selected="true"] { background: #ffffff0b; color: #fff; }
        .tool-option-label { font-size: 12px; font-weight: 600; }
        .tool-option-description { color: #818b9d; font-size: 10px; }
        .selected-tools { display: flex; flex-wrap: wrap; gap: 6px; padding-top: 2px; }
        .selected-tools[hidden] { display: none; }
        .selected-tool { display: inline-flex; align-items: center; gap: 5px; border: 1px solid #fb923c55; border-radius: 7px; padding: 3px 5px 3px 8px; color: #fdba74; background: #fb923c12; font-size: 10px; }
        .selected-tool-remove { width: 16px; height: 16px; display: grid; place-items: center; border: 0; border-radius: 4px; color: #fdba74; background: transparent; font-size: 14px; line-height: 1; cursor: pointer; }
        .selected-tool-remove:hover { background: #fb923c25; color: #fff; }
        .model-picker { position: relative; }
        .model-picker-button { display: flex; align-items: center; gap: 7px; max-width: min(38vw, 230px); border: 1px solid #ffffff12; border-radius: 8px; padding: 6px 8px; color: #b6becc; background: #ffffff04; font-size: 10px; cursor: pointer; }
        .model-picker-button:hover, .model-picker-button[aria-expanded="true"] { border-color: #fb923c66; color: #ffedd5; }
        
        /* Thinking mode toggle button */
        .thinking-mode-button { display: flex; align-items: center; gap: 6px; border: 1px solid #ffffff12; border-radius: 8px; padding: 6px 9px; color: #94a3b8; background: #ffffff04; font-size: 10px; cursor: pointer; transition: all .18s; }
        .thinking-mode-button:hover { border-color: #fb923c66; color: #ffedd5; background: #ffffff08; }
        .thinking-mode-button.active { border-color: #fb923c88; color: #fdba74; background: #fb923c20; font-weight: 500; }
        .thinking-mode-button.disabled-mode { opacity: .55; text-decoration: line-through; }
        .thinking-mode-button svg { display: block; flex: none; }
        .model-picker-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .model-picker-menu { position: absolute; z-index: 12; right: 0; bottom: calc(100% + 7px); width: min(275px, 78vw); max-height: 310px; overflow: auto; padding: 6px; border: 1px solid #ffffff18; border-radius: 11px; background: #211912; box-shadow: 0 14px 32px #0009; }
        .model-picker-menu[hidden] { display: none; }
        .model-option { width: 100%; display: flex; align-items: flex-start; gap: 9px; padding: 9px; border: 0; border-radius: 7px; color: #c4cad5; background: transparent; text-align: left; font-size: 11px; cursor: pointer; }
        .model-option:hover, .model-option[aria-selected="true"] { background: #ffffff0b; color: #fff; }
        .model-option-copy { min-width: 0; display: grid; gap: 3px; }
        .model-option-provider { color: #818b9d; font-size: 9px; }
        .model-picker-more { width: 100%; border: 0; border-top: 1px solid #ffffff0c; color: #737d91; background: transparent; text-align: left; font-size: 10px; padding: 9px; }
        .composer textarea { display: block; flex: 1; min-width: 0; width: 0; min-height: 44px; max-height: 170px; overflow-y: auto; resize: none; border: 0; outline: 0; padding: 9px 0; color: #edf0f7; background: transparent; font-size: 14px; line-height: 1.6; }
        .composer textarea::placeholder { color: #697386; }
        
        .send { width: 40px; height: 40px; display: grid; flex: none; place-items: center; border: 0; border-radius: 11px; padding: 0; color: #21140a; background: #fdba74; cursor: pointer; transition: background .18s, transform .18s; }
        .send:hover:not(:disabled) { background: #fed7aa; transform: translateY(-1px); }
        .send:disabled { opacity: .48; cursor: default; }
        .send svg, .send-icon { display: block; object-fit: contain; }
        
        /* Custom PNG icon styles */
        .sidebar-icon, .newchat-icon, .action-icon { display: block; object-fit: contain; filter: invert(0.85); transition: filter .15s, opacity .15s; }
        .menu-toggle:hover .sidebar-icon, .new-chat:hover .newchat-icon { filter: invert(1); }
        .conversation-action .action-icon { opacity: 0.6; }
        .conversation-action:hover .action-icon, .conversation-action.pinned .action-icon { opacity: 1; filter: invert(1); }

        /* Collapsed sidebar quick-action icons */
        .sidebar-collapsed-icons { position: absolute; top: 74px; left: 0; width: 56px; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 4px 0; opacity: 0; pointer-events: none; transition: opacity .14s ease .06s; z-index: 21; }
        .app.menu-closed .sidebar-collapsed-icons { opacity: 1; pointer-events: auto; transition: opacity .18s ease .12s; }
        .collapsed-icon-btn { width: 36px; height: 36px; display: grid; place-items: center; border: 1px solid transparent; border-radius: 9px; color: #9aa3b5; background: transparent; cursor: pointer; transition: background .15s, border-color .15s; }
        .collapsed-icon-btn:hover { background: #ffffff0d; border-color: var(--line); color: #fff; }
        .collapsed-icon-img { display: block; object-fit: contain; filter: invert(0.75); transition: filter .15s; }
        .collapsed-icon-btn:hover .collapsed-icon-img { filter: invert(1); }

        /* Sidebar search button (open sidebar) */
        .sidebar-search-btn { width: 100%; display: flex; align-items: center; gap: 8px; border: 0; border-radius: 8px; color: #cbd5e1; background: transparent; padding: 6px 10px; font-size: 13px; font-weight: 500; cursor: pointer; transition: background .15s, color .15s; }
        .sidebar-search-btn:hover { background: #ffffff0c; color: #fff; }
        .search-btn-icon { display: block; object-fit: contain; filter: invert(0.85); transition: filter .15s; flex: none; }
        .sidebar-search-btn:hover .search-btn-icon { filter: invert(1); }
        .search-modal-icon { display: block; object-fit: contain; filter: invert(0.6); flex: none; }

        /* Search modal overlay */
        .search-overlay { position: fixed; inset: 0; z-index: 50; display: flex; align-items: flex-start; justify-content: center; padding-top: clamp(60px, 12vh, 130px); background: rgba(12, 8, 5, 0.76); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
        .search-overlay[hidden] { display: none; }
        .search-modal { width: min(560px, calc(100vw - 32px)); border: 1px solid #ffffff1a; border-radius: 14px; background: #1b1612; animation: searchIn .18s ease-out forwards; overflow: hidden; box-shadow: 0 24px 64px #00000088, 0 0 0 1px #ffffff08; }
        @keyframes searchIn { from { opacity: 0; transform: translateY(-10px) scale(.97); } to { opacity: 1; transform: none; } }
        .search-modal-header { display: flex; align-items: center; gap: 10px; padding: 12px 14px; background: #1d1712; border-bottom: 1px solid #ffffff0f; }
        .search-modal-input { flex: 1; border: 0; outline: 0; background: transparent; color: #edf0f7; font: inherit; font-size: 14px; caret-color: #fb923c; }
        .search-modal-input::placeholder { color: #4e5769; }
        .search-modal-input::-webkit-search-cancel-button { display: none; }
        .search-modal-close { width: 28px; height: 28px; display: grid; place-items: center; border: 1px solid #ffffff12; border-radius: 7px; color: #7a8499; background: transparent; cursor: pointer; flex: none; transition: background .15s, color .15s; }
        .search-modal-close:hover { background: #ffffff0d; color: #e5e7eb; }
        .search-results { max-height: min(380px, 55vh); overflow-y: auto; background: #15110e; scrollbar-width: thin; scrollbar-color: #51473d transparent; }
        .search-result-item { width: 100%; display: flex; align-items: center; gap: 10px; padding: 11px 16px; border: 0; border-bottom: 1px solid #ffffff07; background: transparent; color: #c4cad5; text-align: left; font: inherit; font-size: 13px; cursor: pointer; transition: background .12s, color .12s; }
        .search-result-item:last-child { border-bottom: 0; }
        .search-result-item:hover { background: #ffffff0a; color: #edf0f7; }
        .search-result-item mark { background: transparent; color: #fdba74; font-weight: 600; }
        .search-result-empty { padding: 24px 16px; color: #4e5769; font-size: 13px; text-align: center; }
        .search-result-icon { width: 28px; height: 28px; flex: none; display: grid; place-items: center; border-radius: 7px; background: #ffffff08; color: #818b9d; }

        .footer { width: min(100%, 920px); flex: none; margin-inline: auto; text-align: center; color: #687184; font-size: 10px; padding: 5px 0 0; }
        .chat-scroll::-webkit-scrollbar, .conversation-list::-webkit-scrollbar { width: 8px; }
        .chat-scroll::-webkit-scrollbar-track, .conversation-list::-webkit-scrollbar-track { background: transparent; }
        .chat-scroll::-webkit-scrollbar-thumb, .conversation-list::-webkit-scrollbar-thumb { border: 2px solid transparent; border-radius: 999px; background: #444b5a; background-clip: padding-box; }
        .chat-scroll::-webkit-scrollbar-thumb:hover, .conversation-list::-webkit-scrollbar-thumb:hover { background: #606a7d; background-clip: padding-box; }
        @media (max-width: 700px) {
            .model-picker-button { max-width: min(30vw, 120px); }
            .sidebar { width: min(300px, 86vw); box-shadow: 18px 0 45px #0008; }
            .app.menu-closed .sidebar { width: 56px; box-shadow: none; }
            .main { width: 100%; margin-left: 0; }
            .app.menu-closed .main { width: calc(100% - 56px); margin-left: 56px; }
            .chat { padding: 12px 15px 8px; }
            .welcome { margin-bottom: 24px; }
            .messages { gap: 18px; }
            .composer-wrap { padding-top: 8px; }
            .message.user .message-body { max-width: 88%; }
        }
`;

const style = document.createElement('style');
style.textContent = themeStyles;
document.head.append(style);
