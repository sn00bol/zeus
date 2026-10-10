const themeStyles = String.raw`
:root {
            color-scheme: dark;
            font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            background: #0b0e14;
            color: #edf0f7;
            font-synthesis: none;
            text-rendering: optimizeLegibility;
            --muted: #8b93a5;
            --line: rgba(255, 255, 255, .08);
            --surface: #111620;
            --accent: #a78bfa;
        }
        * { box-sizing: border-box; }
        body { margin: 0; min-width: 320px; height: 100vh; overflow: hidden; }
        button, textarea { font: inherit; }
        .app { height: 100vh; height: 100dvh; overflow: hidden; }
        .sidebar { position: fixed; z-index: 20; inset: 0 auto 0 0; width: 250px; height: 100vh; height: 100dvh; overflow: visible; background: #0e121a; border-right: 1px solid var(--line); transition: width .22s ease; }
        .menubar { position: relative; z-index: 22; width: 100%; height: 66px; flex: none; padding: 0 17px; display: flex; align-items: center; background: #0e121a; }
        .menubar-brand { position: absolute; left: 17px; color: #e8e4f7; font-size: 14px; font-weight: 800; letter-spacing: .17em; opacity: 1; transform: translateX(0); transition: opacity .14s ease, transform .2s ease; }
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
        .conversation-rename-input { min-width: 0; flex: 1; border: 1px solid #a78bfa66; border-radius: 6px; outline: 0; padding: 6px 7px; color: #edf0f7; background: transparent; font: inherit; font-size: 11px; }
        .conversation-rename-input:disabled { opacity: .6; }
        .conversation-rename-error { position: absolute; top: calc(100% + 2px); left: 8px; z-index: 2; max-width: calc(100% - 16px); color: #fda4af; font-size: 10px; }
        .conversation-actions { display: flex; align-items: center; padding-right: 4px; opacity: 0; transition: opacity .12s; }
        .conversation-row:hover .conversation-actions, .conversation-row:focus-within .conversation-actions { opacity: 1; }
        .conversation-action { width: 27px; height: 27px; display: grid; place-items: center; border: 0; border-radius: 7px; color: #8e98aa; background: transparent; font-size: 15px; cursor: pointer; }
        .conversation-action:hover, .conversation-action[aria-pressed="true"] { color: #d6c9ff; background: #ffffff0d; }
        .conversation-menu { position: fixed; z-index: 30; width: 150px; padding: 5px; border: 1px solid #ffffff18; border-radius: 10px; background: #171c27; box-shadow: 0 12px 30px #0008; }
        .conversation-menu[hidden] { display: none; }
        .conversation-menu button { width: 100%; display: block; padding: 8px 9px; text-align: left; border: 0; border-radius: 6px; color: #c4cad5; background: transparent; font-size: 11px; cursor: pointer; }
        .conversation-menu button:hover { background: #ffffff0d; color: #fff; }
        .conversation-menu button.danger { color: #fda4af; }
        .archive-toggle { width: 100%; display: flex; align-items: center; gap: 8px; padding: 5px; border: 0; color: #818b9d; background: transparent; text-align: left; font-size: 11px; cursor: pointer; }
        .archive-toggle:hover { color: #d4d8e2; }
        .conversation-empty { color: #727c8f; font-size: 11px; padding: 4px 5px; }
        .history-note { display: flex; align-items: flex-start; gap: 10px; color: #a3aaba; font-size: 12px; line-height: 1.6; padding: 12px 9px; border: 1px solid var(--line); border-radius: 10px; background: #ffffff04; }
        .history-note svg { flex: none; margin-top: 1px; color: #a78bfa; }
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
        .delete-dialog { width: min(440px, calc(100vw - 32px)); border: 1px solid #ffffff1a; border-radius: 16px; padding: 0; color: #edf0f7; background: #171c27; box-shadow: 0 24px 80px #000b; }
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
        .welcome-icon { width: 56px; height: 56px; margin: 0 auto 18px; border: 1px solid #a78bfa35; border-radius: 18px; display: grid; place-items: center; color: #c4b5fd; background: radial-gradient(circle at top left, #a78bfa22, #a78bfa08); }
        h1 { margin: 0; font-size: clamp(25px, 4vw, 34px); letter-spacing: -.04em; }
        .welcome p { margin: 11px auto 0; color: var(--muted); font-size: 14px; line-height: 1.7; }
        .messages { display: flex; flex-direction: column; gap: 22px; padding: 24px 0 28px; }
        .message { display: flex; align-items: flex-start; animation: appear .22s ease-out; }
        @keyframes appear { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
        .message-body { min-width: 0; max-width: 100%; padding-top: 1px; }
        .message.user { justify-content: flex-end; }
        .message.user .message-body { max-width: min(78%, 620px); padding: 11px 15px; border: 1px solid #a78bfa1c; border-radius: 16px 16px 4px 16px; background: linear-gradient(145deg, #a78bfa1b, #ffffff08); color: #f0edf8; }
        .message-content { color: #e4e7ee; font-size: 14px; line-height: 1.75; overflow-wrap: anywhere; }
        .message.user .message-content { color: #f0edf8; white-space: pre-wrap; }
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
        .message-content a { color: #c4b5fd; text-decoration: underline; text-underline-offset: 3px; }
        .message-content p code, .message-content li code, .inline-code { border: 1px solid #ffffff12; border-radius: 5px; padding: 2px 5px; color: #e9d5ff; background: #ffffff0b; font: .9em ui-monospace, SFMono-Regular, Consolas, monospace; }
        .message-content pre { position: relative; margin: 12px 0 16px; overflow: hidden; border: 1px solid #ffffff13; border-radius: 11px; background: #090c12; }
        .message-content pre code { display: block; overflow: auto; padding: 13px 15px 16px; color: #d5d9e3; font: 12px/1.7 ui-monospace, SFMono-Regular, Consolas, monospace; white-space: pre; }
        
        /* Syntax Highlighting */
        .tok-kw { color: #c084fc; font-weight: 600; }
        .tok-str { color: #86efac; }
        .tok-num { color: #f472b6; }
        .tok-com { color: #64748b; font-style: italic; }
        .tok-builtin { color: #67e8f9; }
        .tok-fn { color: #38bdf8; }
        .tok-tag { color: #fb7185; }

        /* Tables */
        .table-wrapper { overflow-x: auto; margin: 14px 0; border: 1px solid #ffffff14; border-radius: 9px; background: #0e121a; }
        .markdown-table { width: 100%; border-collapse: collapse; font-size: 13px; text-align: left; }
        .markdown-table th { background: #151a24; padding: 9px 13px; border-bottom: 1px solid #ffffff16; font-weight: 600; color: #f1f5f9; white-space: nowrap; }
        .markdown-table td { padding: 8px 13px; border-bottom: 1px solid #ffffff08; color: #cbd5e1; }
        .markdown-table tr:last-child td { border-bottom: 0; }
        .markdown-table tr:hover td { background: #ffffff04; }

        /* Task lists */
        .task-list { list-style: none; padding-left: 2px; margin: 8px 0; }
        .task-item { display: flex; align-items: baseline; gap: 8px; margin: 4px 0; }
        .task-item input[type="checkbox"] { accent-color: #a78bfa; margin: 0; transform: translateY(1px); }

        /* Blockquotes */
        .message-content blockquote { margin: 12px 0; padding: 6px 14px; border-left: 3px solid #a78bfa88; background: #ffffff05; border-radius: 0 8px 8px 0; color: #94a3b8; }
        .message-content blockquote p { margin: 0; }
        
        /* Math */
        .math-block-container { display: flex; justify-content: center; margin: 14px 0; overflow-x: auto; }
        .math-block { display: inline-block; padding: 7px 16px; background: #0b0f17; border: 1px solid #a78bfa25; border-radius: 8px; font-family: "Cambria Math", "Latin Modern Math", serif; font-size: 1.15em; color: #e2e8f0; font-style: italic; letter-spacing: .02em; }
        .math-inline { display: inline; font-family: "Cambria Math", "Latin Modern Math", serif; font-size: 1.05em; color: #e2e8f0; font-style: italic; }

        /* Horizontal rule & Strikethrough */
        .markdown-hr { border: 0; height: 1px; background: #ffffff14; margin: 18px 0; }
        .message-content del { color: #94a3b8; text-decoration: line-through; }
        .message-content mark { background: #fef08a26; color: #fef08a; padding: 1px 3px; border-radius: 3px; }

        .code-toolbar { display: flex; align-items: center; justify-content: space-between; padding: 7px 10px; border-bottom: 1px solid #ffffff10; color: #858da0; background: #ffffff04; font-size: 10px; }
        .code-copy { border: 1px solid #ffffff13; border-radius: 6px; padding: 4px 8px; color: #b8bfce; background: #ffffff08; font-size: 10px; cursor: pointer; transition: background .15s; }
        .code-copy:hover { color: #fff; background: #ffffff12; }
        .stream-details { display: flex; flex-wrap: wrap; gap: 7px 12px; margin-top: 9px; color: #778195; font-size: 10px; }
        .message.error .message-content { color: #fda4af; }
        .loading-state { display: grid; gap: 8px; min-height: 26px; color: #aeb5c3; font-size: 13px; }
        .loading-row { display: inline-flex; align-items: center; gap: 10px; min-height: 26px; cursor: pointer; user-select: none; }
        .loading-spinner { width: 16px; height: 16px; flex: none; border: 2px solid #a78bfa35; border-top-color: #c4b5fd; border-radius: 50%; animation: spin .75s linear infinite; }
        .thinking-icon { display: flex; align-items: center; color: #a78bfa; }
        .thinking-toggle { width: 26px; height: 26px; display: grid; place-items: center; border: 1px solid #ffffff14; border-radius: 7px; color: #9aa3b5; background: #ffffff08; cursor: pointer; }
        .thinking-toggle:hover { color: #e6dfff; border-color: #a78bfa55; background: #ffffff10; }
        .thinking-toggle svg { display: block; transition: transform .18s ease; }
        .loading-state.thinking-open .thinking-toggle svg { transform: rotate(180deg); }
        .thinking-panel { max-height: 320px; overflow: auto; border: 1px solid #ffffff12; border-radius: 10px; padding: 10px 12px; background: #0c1018; box-shadow: inset 0 2px 6px #0004; }
        .thinking-text { margin: 0; color: #9aa3b5; font: 12px/1.65 ui-monospace, SFMono-Regular, Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
        .loading-state.thinking-finished .loading-label { color: #8b93a5; font-size: 12px; }
        .loading-state.thinking-finished .loading-row:hover .loading-label { color: #cbd5e1; }
        .message-thinking { margin-bottom: 10px; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .composer-wrap { width: min(100%, 920px); flex: none; margin-inline: auto; padding: 12px 0 5px; }
        .composer { width: 100%; display: flex; align-items: flex-end; gap: 10px; position: relative; border: 1px solid #ffffff17; border-radius: 16px; padding: 8px 9px 8px 16px; background: #121722; box-shadow: 0 12px 40px #0003; transition: border-color .2s; }
        .composer:focus-within { border-color: #a78bfa66; }
        .composer.multiline { flex-direction: column; align-items: stretch; gap: 4px; }
        .composer.multiline textarea { flex: none; width: 100%; }
        .composer-actions { display: flex; align-items: center; gap: 8px; flex: none; }
        .composer.multiline .composer-actions { align-self: flex-end; }
        .model-picker { position: relative; }
        .model-picker-button { display: flex; align-items: center; gap: 7px; max-width: min(38vw, 230px); border: 1px solid #ffffff12; border-radius: 8px; padding: 6px 8px; color: #b6becc; background: #ffffff04; font-size: 10px; cursor: pointer; }
        .model-picker-button:hover, .model-picker-button[aria-expanded="true"] { border-color: #a78bfa55; color: #e6dfff; }
        
        /* Thinking mode toggle button */
        .thinking-mode-button { display: flex; align-items: center; gap: 6px; border: 1px solid #ffffff12; border-radius: 8px; padding: 6px 9px; color: #94a3b8; background: #ffffff04; font-size: 10px; cursor: pointer; transition: all .18s; }
        .thinking-mode-button:hover { border-color: #a78bfa55; color: #e6dfff; background: #ffffff08; }
        .thinking-mode-button.active { border-color: #a78bfa88; color: #c4b5fd; background: #a78bfa18; font-weight: 500; }
        .thinking-mode-button.disabled-mode { opacity: .55; text-decoration: line-through; }
        .thinking-mode-button svg { display: block; flex: none; }
        .model-picker-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .model-picker-menu { position: absolute; z-index: 12; right: 0; bottom: calc(100% + 7px); width: min(275px, 78vw); max-height: 310px; overflow: auto; padding: 6px; border: 1px solid #ffffff18; border-radius: 11px; background: #171c27; box-shadow: 0 14px 32px #0009; }
        .model-picker-menu[hidden] { display: none; }
        .model-option { width: 100%; display: flex; align-items: flex-start; gap: 9px; padding: 9px; border: 0; border-radius: 7px; color: #c4cad5; background: transparent; text-align: left; font-size: 11px; cursor: pointer; }
        .model-option:hover, .model-option[aria-selected="true"] { background: #ffffff0b; color: #fff; }
        .model-option-copy { min-width: 0; display: grid; gap: 3px; }
        .model-option-provider { color: #818b9d; font-size: 9px; }
        .model-picker-more { width: 100%; border: 0; border-top: 1px solid #ffffff0c; color: #737d91; background: transparent; text-align: left; font-size: 10px; padding: 9px; }
        .composer textarea { display: block; flex: 1; min-width: 0; width: 0; min-height: 44px; max-height: 170px; overflow-y: auto; resize: none; border: 0; outline: 0; padding: 9px 0; color: #edf0f7; background: transparent; font-size: 14px; line-height: 1.6; }
        .composer textarea::placeholder { color: #697386; }
        
        .send { width: 40px; height: 40px; display: grid; flex: none; place-items: center; border: 0; border-radius: 11px; padding: 0; color: #171321; background: #c4b5fd; cursor: pointer; transition: background .18s, transform .18s; }
        .send:hover:not(:disabled) { background: #d3c9ff; transform: translateY(-1px); }
        .send:disabled { opacity: .48; cursor: default; }
        .send svg, .send-icon { display: block; object-fit: contain; }
        
        /* Custom PNG icon styles */
        .sidebar-icon, .newchat-icon, .action-icon { display: block; object-fit: contain; filter: invert(0.85); transition: filter .15s, opacity .15s; }
        .menu-toggle:hover .sidebar-icon, .new-chat:hover .newchat-icon { filter: invert(1); }
        .conversation-action .action-icon { opacity: 0.6; }
        .conversation-action:hover .action-icon, .conversation-action.pinned .action-icon { opacity: 1; filter: invert(1); }
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
