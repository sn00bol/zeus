import { sanitizeHtml } from './renderHTML.js';
import { initializeScrollbar } from './scrollbar.js';

const TEMPORARY_THEME_COLORS = {
    accent: '#ffffff',
    sidebar: '#000000',
    background: '#000000',
    foreground: '#ededed',
};

const SETTINGS_STYLE = `
@font-face {
    font-family: "Streetsign Sans";
    src: url("/font/Streetsign-Sans.otf") format("opentype");
    font-display: swap;
}
.settings-dialog {
    width: min(980px, calc(100vw - 32px));
    height: min(700px, calc(100dvh - 32px));
    max-width: none;
    max-height: none;
    padding: 0;
    overflow: hidden;
    border: 1px solid #ffffff18;
    border-radius: 18px;
    color: #edf0f7;
    background: #111111;
    box-shadow: 0 32px 100px #000b, 0 0 0 1px #ffffff08;
}
.settings-dialog::backdrop {
    background: rgba(0, 0, 0, .84);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
}
.settings-shell { width: 100%; height: 100%; min-height: 0; display: grid; grid-template-columns: 230px minmax(0, 1fr); }
.settings-sidebar { min-width: 0; display: flex; flex-direction: column; gap: 4px; padding: 16px 12px; border-right: 1px solid #ffffff0f; background: #191919; }
.settings-brand { margin: 0 10px 14px; color: #f8fafc; font-size: 15px; font-weight: 650; letter-spacing: .02em; }
.settings-nav { width: 100%; display: flex; align-items: center; gap: 11px; padding: 10px 11px; border: 1px solid transparent; border-radius: 9px; color: #a7a09a; background: transparent; text-align: left; font: inherit; font-size: 13px; cursor: pointer; transition: background .15s, color .15s, border-color .15s; }
.settings-nav:hover { color: #f5f5f4; background: #ffffff08; }
.settings-nav[aria-current="page"] { color: var(--user-accent, #1d4ed8); border-color: color-mix(in srgb, var(--user-accent, #1d4ed8) 25%, transparent); background: color-mix(in srgb, var(--user-accent, #1d4ed8) 10%, transparent); }
.settings-nav img { width: 16px; height: 16px; flex: none; object-fit: contain; filter: invert(.84); }
.settings-nav[data-section="information"] img { filter: none; }
.sidebar-settings-button img { width: 18px; height: 18px; object-fit: contain; filter: invert(.84); }
.sidebar-settings-button:hover img { filter: invert(1); }
.sidebar-settings-button:focus-visible { outline: 2px solid var(--user-accent, #1d4ed8); outline-offset: 2px; }
.settings-main { min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.settings-header { min-height: 62px; display: grid; grid-template-columns: minmax(0, 1fr) minmax(180px, 380px) minmax(0, 1fr); align-items: center; gap: 12px; padding: 10px 18px; border-bottom: 1px solid #ffffff0f; }
.settings-search-wrap { min-width: 0; position: relative; grid-column: 2; }
.settings-search { width: 100%; height: 38px; box-sizing: border-box; padding: 0 14px 0 40px; border: 1px solid #ffffff18; border-radius: 999px; outline: 0; color: #f5f5f4; background: #ffffff06; font: inherit; font-size: 12px; }
.settings-search::placeholder { color: #928a83; }
.settings-search-icon { position: absolute; top: 11px; left: 13px; width: 16px; height: 16px; object-fit: contain; filter: invert(.65); pointer-events: none; }
.settings-search-wrap.search-open .settings-search { border-radius: 19px 19px 0 0; border-bottom-color: transparent; background: #111111; }
.settings-search-results { position: absolute; z-index: 2; top: calc(100% - 1px); right: 0; left: 0; display: grid; gap: 3px; max-height: min(320px, 50vh); overflow: auto; padding: 5px; border: 1px solid #ffffff18; border-top: 0; border-radius: 0 0 19px 19px; background: #111111; box-shadow: 0 14px 32px #0009; }
.settings-search-results.is-scrollable { padding-right: 34px; }
.settings-search-results[hidden] { display: none; }
.settings-search-results::-webkit-scrollbar { display: none; width: 0; height: 0; }
.settings-search-results { scrollbar-width: none; overscroll-behavior: contain; }
.settings-search-wrap .chat-scrollbar { z-index: 3; right: 0; width: 30px; height: 0; }
.settings-search-result { width: 100%; padding: 9px 10px; border: 0; border-radius: 6px; color: #e7e5e4; background: transparent; text-align: left; font: inherit; font-size: 12px; cursor: pointer; }
.settings-search-result:hover, .settings-search-result:focus-visible { outline: 0; color: var(--user-accent, #1d4ed8); background: color-mix(in srgb, var(--user-accent, #1d4ed8) 10%, transparent); }
.settings-search-empty { margin: 0; padding: 9px 10px; color: #a8a29e; font-size: 11px; }
.settings-close { width: 34px; height: 34px; flex: none; display: grid; place-items: center; border: 1px solid #ffffff12; border-radius: 9px; color: #a8a29e; background: #ffffff04; font: inherit; font-size: 24px; line-height: 1; cursor: pointer; }
.settings-header > .settings-close { grid-column: 3; justify-self: end; }
.settings-close:hover { color: #fff; background: #ffffff0d; }
.settings-content-wrap { min-height: 0; position: relative; flex: 1; display: flex; }
.settings-content { min-height: 0; flex: 1; overflow: auto; padding: 16px 38px 16px 20px; }
.settings-content-wrap > .chat-scrollbar { z-index: 2; top: 8px; right: 0; bottom: 8px; width: 30px; height: auto; }
.settings-page[hidden] { display: none; }
.settings-section-title { margin: 0 0 12px; color: #f5f5f4; font-size: 18px; font-weight: 600; }
.settings-description { margin: 0; color: #928a83; font-size: 12px; line-height: 1.6; }
.settings-version-banner { min-height: 280px; position: relative; overflow: hidden; border-radius: 18px; background: #f97316 url("/banner-background.png") center / cover no-repeat; container-type: inline-size; }
.settings-version-banner::after { position: absolute; inset: 0; background: linear-gradient(270deg, rgba(234, 88, 12, .94), rgba(249, 115, 22, .58) 42%, transparent 82%); content: ""; pointer-events: none; }
.settings-version-copy { position: absolute; z-index: 1; right: clamp(18px, 4vw, 40px); bottom: 0; display: grid; justify-items: end; gap: 2px; color: #431407; text-align: right; }
.settings-version-value { font-family: "Streetsign Sans", sans-serif; font-size: clamp(72px, 24cqw, 192px); font-weight: 400; line-height: .9; letter-spacing: -.03em; }
.settings-version-error { margin: 12px 0 0; color: #fda4af; font-size: 12px; }
.settings-info-grid { width: min(100%, 760px); display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 16px; margin: 20px auto 0; }
.settings-info-card { min-width: 0; display: grid; gap: 10px; padding: 20px; border: 1px solid #ffffff14; border-radius: 14px; background: linear-gradient(145deg, #ffffff0b, #ffffff04); box-shadow: inset 0 1px #ffffff08; }
.settings-info-card-primary { min-height: 132px; align-content: center; }
.settings-info-card-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; color: #a8a29e; font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; }
.settings-info-card-logo { display: block; width: auto; max-width: min(100%, 112px); height: 30px; object-fit: contain; object-position: left center; }
.settings-info-card-value { overflow-wrap: anywhere; color: #f5f5f4; font-size: 26px; font-weight: 650; letter-spacing: -.025em; }
.settings-info-card-detail { min-height: 1.4em; color: #a8a29e; font-size: 11px; line-height: 1.4; }
.settings-info-runtime { grid-column: 1 / -1; display: grid; grid-template-columns: minmax(0, 1fr); overflow: hidden; border: 1px solid #ffffff14; border-radius: 12px; background: #ffffff08; }
.settings-info-runtime-section { min-width: 0; position: relative; display: grid; }
.settings-info-runtime-section + .settings-info-runtime-section::before { position: absolute; top: 0; right: 16px; left: 16px; height: 1px; background: #ffffff18; content: ""; }
.settings-info-runtime-item { min-width: 0; position: relative; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 13px 16px; }
.settings-info-runtime-name { min-width: 0; display: flex; align-items: center; }
.settings-info-runtime-label { color: #a8a29e; font-size: 10px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; }
.settings-info-runtime-value { overflow-wrap: anywhere; color: #d6d3d1; font-size: 16px; font-weight: 600; font-variant-numeric: tabular-nums; }
.settings-info-dependencies { display: grid; grid-template-columns: minmax(0, 1fr); gap: 2px; margin: 0; padding: 0 16px 10px; list-style: none; }
.settings-info-dependency { min-width: 0; display: flex; justify-content: flex-start; gap: 8px; color: #928a83; font-size: 11px; line-height: 1.25; }
.settings-info-dependency-name { min-width: 0; overflow-wrap: anywhere; }
.settings-info-dependency-version { flex: none; color: #827a73; font-variant-numeric: tabular-nums; }
.settings-info-project { margin-top: 12px; }
.settings-info-project-item { width: 100%; position: relative; appearance: none; -webkit-appearance: none; border: 0; border-radius: 0; box-shadow: none; color: inherit; background: transparent; text-align: left; cursor: pointer; font: inherit; }
.settings-info-project-item + .settings-info-project-item::before { position: absolute; top: 0; right: 16px; left: 16px; height: 1px; background: #ffffff18; content: ""; }
.settings-info-project-item:hover { background: #ffffff0d; }
.settings-info-project-item:focus { color: inherit; background: transparent; }
.settings-info-project-item:active { background: #ffffff0d; }
.settings-info-project-item:focus-visible { z-index: 1; outline: 2px solid var(--user-accent, #1d4ed8); outline-offset: -2px; background: #ffffff08; }
.settings-info-project-arrow { color: #78716c; font-size: 18px; transition: transform .15s, color .15s; }
.settings-info-project-item:hover .settings-info-project-arrow { color: var(--user-accent, #1d4ed8); transform: translateX(3px); }
.settings-doc-dialog { width: min(760px, calc(100vw - 32px)); max-width: none; max-height: min(80dvh, 760px); padding: 0; overflow: hidden; border: 1px solid #ffffff18; border-radius: 16px; color: #edf0f7; background: #111111; box-shadow: 0 32px 100px #000b; }
.settings-doc-dialog::backdrop { background: #050403d9; backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
.settings-doc-dialog-header { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 18px; border-bottom: 1px solid #ffffff12; background: #111111; }
.settings-doc-dialog-title { margin: 0; color: #f5f5f4; font-size: 16px; font-weight: 600; }
.settings-doc-dialog-body { min-height: 0; position: relative; }
.settings-doc-dialog-content { max-height: calc(80dvh - 60px); overflow: auto; padding: 18px 34px 24px 22px; color: #c4bcb5; font-size: 13px; line-height: 1.7; scrollbar-width: none; overscroll-behavior: contain; }
.settings-doc-dialog-content::-webkit-scrollbar { display: none; width: 0; height: 0; }
.settings-doc-dialog .chat-scrollbar { z-index: 2; top: 8px; right: 0; bottom: 8px; width: 30px; height: auto; }
.settings-doc-dialog-content h1, .settings-doc-dialog-content h2, .settings-doc-dialog-content h3 { margin: 18px 0 8px; color: #f5f5f4; font-size: 16px; }
.settings-doc-dialog-content p, .settings-doc-dialog-content ul, .settings-doc-dialog-content ol, .settings-doc-dialog-content blockquote { margin: 8px 0; }
.settings-doc-dialog-content a { color: var(--user-accent, #1d4ed8); }
.settings-doc-dialog-content pre { overflow: auto; padding: 10px; border-radius: 7px; background: #0004; }
.settings-doc-dialog-content code { font-size: .95em; }
.settings-doc-dialog-content img { max-width: 100%; }
.settings-info-license { margin: 18px 0 4px; color: #928a83; text-align: center; font-size: 11px; line-height: 1.6; }
.settings-info-license a { color: var(--user-accent, #1d4ed8); text-decoration: underline; text-underline-offset: 3px; }
.settings-model-panel { padding: 0; }
.settings-model-panel-heading-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.settings-model-panel-heading-row .settings-section-title { margin: 0; }
.settings-catalog-refresh { width: 28px; height: 28px; display: grid; place-items: center; padding: 0; border: 0; border-radius: 6px; color: #a8a29e; background: transparent; cursor: pointer; }
.settings-catalog-refresh:hover:not(:disabled) { color: var(--user-accent, #1d4ed8); }
.settings-catalog-refresh img { width: 16px; height: 16px; object-fit: contain; filter: invert(.72); }
.settings-catalog-refresh:hover:not(:disabled) img { filter: invert(1); }
.settings-catalog-refresh:disabled { opacity: .55; cursor: wait; }
.settings-model-list { display: grid; gap: 8px; margin-top: 10px; }
.settings-model-card { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 10px 12px; border: 1px solid #ffffff10; border-radius: 10px; background: #ffffff03; }
.settings-model-card-name { min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; overflow-wrap: anywhere; color: #f5f5f4; font-size: 12px; font-weight: 550; }
.settings-provider-icon { width: 15px; height: 15px; flex: none; object-fit: contain; filter: invert(.82); }
.settings-model-card-detail { margin-top: 5px; overflow-wrap: anywhere; color: #928a83; font-size: 10px; }
.settings-model-badge { display: inline-flex; align-items: center; min-height: 19px; padding: 0 6px; border: 1px solid #ffffff12; border-radius: 999px; color: #b7b0aa; background: #ffffff06; font: inherit; font-size: 9px; }
.settings-model-badge[data-supported="true"] { border-color: color-mix(in srgb, var(--user-accent, #1d4ed8) 28%, transparent); color: var(--user-accent, #1d4ed8); background: color-mix(in srgb, var(--user-accent, #1d4ed8) 8%, transparent); }
.settings-model-badge[data-supported="false"] { color: #78716c; text-decoration: line-through; }
.settings-model-card-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 7px; }
.settings-action-disabled { border-color: #fb718566; color: #fecdd3; background: #be123c30; }
.settings-action-disabled:hover:not(:disabled) { border-color: #fb7185aa; background: #be123c55; }
.settings-empty { margin: 0; color: #928a83; font-size: 11px; line-height: 1.5; }
.settings-action { min-height: 38px; padding: 0 13px; border: 1px solid #ffffff17; border-radius: 9px; color: #e7e5e4; background: #ffffff08; font: inherit; font-size: 12px; cursor: pointer; }
.settings-action:hover:not(:disabled) { border-color: color-mix(in srgb, var(--user-accent, #1d4ed8) 35%, transparent); background: color-mix(in srgb, var(--user-accent, #1d4ed8) 8%, transparent); }
.settings-action:disabled { opacity: .55; cursor: wait; }
.settings-status { min-height: 20px; margin: 12px 0 0; color: #a8a29e; font-size: 11px; line-height: 1.5; }
.settings-status[data-error="true"] { color: #fda4af; }
.settings-toggle-row { min-height: 56px; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 10px 0; border-bottom: 1px solid #ffffff0e; }
.settings-appearance-card { display: grid; gap: 16px; margin: 18px 0; padding: 18px; border: 1px solid #ffffff14; border-radius: 14px; background: linear-gradient(145deg, #ffffff0b, #ffffff04); box-shadow: inset 0 1px #ffffff08; }
.settings-theme-mode-card { display: flex; align-items: center; gap: 48px; padding: 24px 28px; }
.settings-appearance-card-title { margin: 0; color: #f5f5f4; font-size: 14px; font-weight: 600; }
.settings-appearance-card-description { margin: -10px 0 0; color: #928a83; font-size: 11px; line-height: 1.5; }
.settings-theme-options { flex: 1; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); align-items: start; gap: clamp(18px, 4vw, 48px); }
.settings-theme-choice { min-width: 0; display: grid; justify-items: center; gap: 8px; }
.settings-theme-option { width: min(100%, 124px); min-width: 0; display: grid; padding: 5px; border: 1px solid transparent; border-radius: 9px; background: transparent; cursor: pointer; }
.settings-theme-option:hover { background: #ffffff08; }
.settings-theme-option[aria-pressed="true"] { border-color: color-mix(in srgb, var(--user-accent) 65%, transparent); }
.settings-theme-preview { width: min(100%, 112px); aspect-ratio: 1.7; display: grid; grid-template-columns: 28% minmax(0, 1fr); overflow: hidden; border: 1px solid #ffffff24; border-radius: 7px; color: #ededed; background: #000000; box-shadow: 0 3px 8px #0003; }
.settings-theme-preview-sidebar { display: grid; align-content: start; gap: 5px; padding: 6px 4px; color: #a3a3a3; background: #191919; }
.settings-theme-preview-brand { width: 62%; height: 3px; margin-bottom: 2px; border-radius: 99px; background: #f5f5f4; }
.settings-theme-preview-nav { width: 78%; height: 2px; border-radius: 99px; background: #ffffff30; }
.settings-theme-preview-nav-active { width: 92%; height: 7px; margin-top: -2px; border-radius: 2px; background: color-mix(in srgb, var(--user-accent) 26%, transparent); }
.settings-theme-preview-main { min-width: 0; display: flex; flex-direction: column; justify-content: space-between; gap: 5px; padding: 6px; }
.settings-theme-preview-messages { display: grid; justify-items: end; gap: 4px; }
.settings-theme-preview-message { width: 76%; height: 9px; border-radius: 4px 4px 1px 4px; background: color-mix(in srgb, var(--user-accent) 42%, transparent); }
.settings-theme-preview-response { width: 88%; height: 3px; border-radius: 99px; background: currentColor; opacity: .35; }
.settings-theme-preview-response-short { width: 58%; justify-self: start; }
.settings-theme-preview-composer { height: 8px; border: 1px solid currentColor; border-radius: 99px; opacity: .4; }
.settings-theme-preview[data-theme-preview="light"] { color: #333333; border-color: #d4d4d4; background: #f5f5f5; }
.settings-theme-preview[data-theme-preview="light"] .settings-theme-preview-sidebar { color: #525252; background: #ffffff; }
.settings-theme-preview[data-theme-preview="light"] .settings-theme-preview-brand { background: #262626; }
.settings-theme-preview[data-theme-preview="light"] .settings-theme-preview-nav { background: #00000020; }
.settings-theme-preview[data-theme-preview="dark"] { color: #ededed; border-color: #444444; background: #000000; }
.settings-theme-preview[data-theme-preview="dark"] .settings-theme-preview-sidebar { color: #a3aaba; background: #191919; }
.settings-theme-preview[data-theme-preview="dark"] .settings-theme-preview-brand { background: #f5f5f4; }
.settings-theme-preview[data-theme-preview="system"] { grid-template-columns: 1fr 1fr; }
.settings-theme-preview-system-half { min-width: 0; display: grid; grid-template-columns: 28% minmax(0, 1fr); overflow: hidden; }
.settings-theme-preview-system-half + .settings-theme-preview-system-half { border-left: 1px solid #888888; }
.settings-theme-preview-system-half .settings-theme-preview-sidebar { gap: 5px; padding: 6px 3px; }
.settings-theme-preview-system-half .settings-theme-preview-main { padding: 6px 4px; }
.settings-theme-preview-system-light { color: #333333; background: #f5f5f5; }
.settings-theme-preview-system-light .settings-theme-preview-sidebar { color: #525252; background: #ffffff; }
.settings-theme-preview-system-light .settings-theme-preview-brand { background: #262626; }
.settings-theme-preview-system-light .settings-theme-preview-nav { background: #00000020; }
.settings-theme-preview-system-dark { color: #ededed; background: #000000; }
.settings-theme-preview-system-dark .settings-theme-preview-sidebar { color: #a3aaba; background: #191919; }
.settings-theme-preview-system-dark .settings-theme-preview-brand { background: #f5f5f4; }
.settings-theme-option-label { color: #a8a29e; font-size: 10px; line-height: 1.2; white-space: nowrap; }
.settings-theme-option:focus-visible { outline: 2px solid var(--user-accent); outline-offset: 3px; }
.settings-custom-color-grid { display: grid; gap: 12px; }
.settings-custom-color-row { min-width: 0; display: grid; grid-template-columns: minmax(100px, 1fr) minmax(180px, 260px); align-items: center; gap: 18px; }
.settings-color-control { min-width: 0; display: flex; align-items: center; gap: 9px; }
.settings-color-picker { width: 34px; height: 34px; flex: none; overflow: hidden; padding: 3px; border: 1px solid #ffffff20; border-radius: 50%; background: transparent; cursor: pointer; }
.settings-color-picker::-webkit-color-swatch-wrapper { padding: 0; }
.settings-color-picker::-webkit-color-swatch { border: 0; border-radius: 50%; }
.settings-color-picker::-moz-color-swatch { border: 0; border-radius: 50%; }
.settings-color-value { width: 100%; min-width: 0; height: 34px; padding: 0 10px; border: 1px solid #ffffff20; border-radius: 8px; outline: 0; color: #d6d3d1; background: #ffffff08; font: 11px ui-monospace, SFMono-Regular, Consolas, monospace; text-transform: uppercase; }
.settings-color-value:focus-visible { border-color: var(--user-accent); outline: 2px solid color-mix(in srgb, var(--user-accent) 30%, transparent); }
.settings-color-error { grid-column: 2; margin: -10px 0 0; color: #fda4af; font-size: 10px; }
.settings-color-error[hidden] { display: none; }
.settings-color-reset-row { display: flex; justify-content: flex-end; padding-top: 4px; }
.settings-color-reset { padding: 7px 10px; border: 1px solid #ffffff17; border-radius: 8px; color: #e7e5e4; background: #ffffff08; font: inherit; font-size: 10px; cursor: pointer; }
.settings-color-reset:hover { border-color: color-mix(in srgb, var(--user-accent) 55%, transparent); background: color-mix(in srgb, var(--user-accent) 12%, transparent); }
.settings-toggle-copy { min-width: 0; display: grid; gap: 5px; }
.settings-toggle-title { color: #e7e5e4; font-size: 13px; font-weight: 500; }
.settings-toggle-description { color: #928a83; font-size: 11px; line-height: 1.5; }
.settings-switch { width: 40px; height: 23px; position: relative; flex: none; border: 1px solid #ffffff20; border-radius: 999px; padding: 0; background: #ffffff12; cursor: pointer; transition: background .16s, border-color .16s; }
.settings-switch::after { position: absolute; top: 3px; left: 3px; width: 15px; height: 15px; border-radius: 50%; background: #b7b0aa; content: ""; transition: transform .16s, background .16s; }
.settings-switch[aria-checked="true"] { border-color: color-mix(in srgb, var(--user-accent, #1d4ed8) 60%, transparent); background: color-mix(in srgb, var(--user-accent, #1d4ed8) 50%, transparent); }
.settings-switch[aria-checked="true"]::after { transform: translateX(17px); background: #fff7ed; }
body[data-theme-mode="light"] .settings-provider-icon { filter: grayscale(1) brightness(.35); }
body[data-theme-mode="dark"] .settings-provider-icon { filter: grayscale(1) brightness(0) invert(1); }
body[data-theme-mode="light"] .settings-model-badge { border-color: #c4c4c4; color: #525252; background: #f5f5f5; }
body[data-theme-mode="light"] .settings-model-badge[data-supported="true"] { border-color: color-mix(in srgb, var(--user-accent) 65%, #a3a3a3); color: color-mix(in srgb, var(--user-accent) 68%, #171717); background: color-mix(in srgb, var(--user-accent) 16%, #ffffff); }
body[data-theme-mode="light"] .settings-model-badge[data-supported="false"] { color: #737373; }
body[data-theme-mode="dark"] .settings-model-badge { border-color: #525252; color: #d4d4d4; background: #262626; }
body[data-theme-mode="dark"] .settings-model-badge[data-supported="true"] { border-color: color-mix(in srgb, var(--user-accent) 68%, #737373); color: color-mix(in srgb, var(--user-accent) 50%, #ffffff); background: color-mix(in srgb, var(--user-accent) 18%, #171717); }
body[data-theme-mode="dark"] .settings-model-badge[data-supported="false"] { color: #a3a3a3; }
body[data-theme-mode="light"] .settings-switch { border-color: #a3a3a3; background: #e5e5e5; }
body[data-theme-mode="light"] .settings-switch::after { background: #ffffff; box-shadow: 0 1px 3px #0005; }
body[data-theme-mode="light"] .settings-switch[aria-checked="true"] { border-color: color-mix(in srgb, var(--user-accent) 75%, #404040); background: color-mix(in srgb, var(--user-accent) 72%, #ffffff); }
body[data-theme-mode="light"] .settings-switch[aria-checked="true"]::after { background: #ffffff; }
body[data-theme-mode="dark"] .settings-switch { border-color: #666666; background: #303030; }
body[data-theme-mode="dark"] .settings-switch::after { background: #d4d4d4; box-shadow: 0 1px 3px #0008; }
body[data-theme-mode="dark"] .settings-switch[aria-checked="true"] { border-color: color-mix(in srgb, var(--user-accent) 75%, #737373); background: color-mix(in srgb, var(--user-accent) 65%, #262626); }
body[data-theme-mode="dark"] .settings-switch[aria-checked="true"]::after { background: #ffffff; }
.settings-switch:focus-visible, .settings-close:focus-visible, .settings-action:focus-visible, .settings-catalog-refresh:focus-visible, .settings-nav:focus-visible { outline: 2px solid var(--user-accent, #1d4ed8); outline-offset: 2px; }
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
    .settings-content { padding: 14px 30px 14px 12px; }
    .settings-model-card { grid-template-columns: minmax(0, 1fr); }
    .settings-model-card-actions { justify-content: flex-start; }
    .settings-theme-mode-card { align-items: stretch; flex-direction: column; gap: 18px; }
}
@media (max-width: 380px) {
    .settings-shell { grid-template-columns: 116px minmax(0, 1fr); }
    .settings-nav { gap: 5px; font-size: 10px; }
    .settings-info-grid { width: min(100%, 280px); grid-template-columns: minmax(0, 1fr); gap: 8px; }
    .settings-info-card-primary { min-height: 100px; padding: 14px; }
    .settings-info-dependencies { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 420px) {
    .settings-appearance-card { padding: 13px; }
    .settings-theme-mode-card { gap: 14px; padding: 13px; }
    .settings-theme-options { gap: 6px; }
    .settings-theme-option { padding: 3px; }
    .settings-theme-option-label { font-size: 9px; }
    .settings-custom-color-row { grid-template-columns: minmax(0, 1fr); gap: 7px; }
    .settings-color-error { grid-column: 1; margin-top: -3px; }
}
`;

const SECTIONS = [
    { id: 'models', label: 'Model Manager', icon: '/icon/model.png' },
    { id: 'search', label: 'Search', icon: '/icon/search.png' },
    { id: 'appearance', label: 'Appearance', icon: '/icon/appearance.png' },
    { id: 'shortcuts', label: 'Shortcut', icon: '/icon/shortcut.png' },
    { id: 'information', label: 'About ZEUS', icon: '/icon/info.png' },
];

const SETTINGS_SEARCH_ITEMS = [
    { label: 'Model Manager', keywords: 'models model catalog provider', section: 'models', target: '.settings-catalog-refresh' },
    { label: 'Refresh model list', keywords: 'models model catalog refresh reload', section: 'models', target: '.settings-catalog-refresh' },
    { label: 'Show the @search tool', keywords: 'search web tool composer', section: 'search', target: '[data-setting="search"]' },
    { label: 'Mode', keywords: 'appearance theme light dark system auto', section: 'appearance', target: '[data-theme-option="light"]' },
    { label: 'Accent color', keywords: 'appearance custom color accent hex', section: 'appearance', target: '[data-color-input="accent"]' },
    { label: 'Sidebar color', keywords: 'appearance custom color sidebar hex', section: 'appearance', target: '[data-color-input="sidebar"]' },
    { label: 'Background color', keywords: 'appearance custom color background hex', section: 'appearance', target: '[data-color-input="background"]' },
    { label: 'Foreground color', keywords: 'appearance custom color foreground text hex', section: 'appearance', target: '[data-color-input="foreground"]' },
    { label: 'Shortcut', keywords: 'keyboard keys shortcut', section: 'shortcuts' },
    { label: 'About ZEUS', keywords: 'about zeus version information', section: 'information' },
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

function readStringPreference(key, validate, fallback) {
    try {
        const value = localStorage.getItem(key);
        return value !== null && validate(value) ? value : fallback;
    } catch (error) {
        console.warn(`[WEBUI] Could not read setting ${key}:`, error);
        return fallback;
    }
}

export function initializeSettings({
    getConversationId,
    loadModels,
    onSearchSettingChange,
}) {
    const initialVersion = document.querySelector('meta[name="zeus-version"]')?.content || '';
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
                            <div class="settings-search-results chat-scroll" id="settings-search-results"
                                role="listbox" hidden></div>
                            <div class="chat-scrollbar" role="scrollbar" tabindex="-1"
                                aria-label="Search results scroll position" aria-controls="settings-search-results"
                                aria-orientation="vertical" aria-valuemin="0" aria-valuemax="1000"
                                aria-valuenow="0">
                                <div class="chat-scrollbar-thumb"></div>
                            </div>
                        </div>
                        <button class="settings-close" type="button" aria-label="Close settings">
                            <span aria-hidden="true">×</span>
                        </button>
                    </header>
                    <div class="settings-content-wrap">
                    <div class="settings-content chat-scroll" id="settings-content">
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
                            <section class="settings-appearance-card settings-theme-mode-card" aria-labelledby="settings-theme-title">
                                <h3 class="settings-appearance-card-title" id="settings-theme-title">Mode</h3>
                                <div class="settings-theme-options" role="group" aria-label="Mode">
                                    <div class="settings-theme-choice">
                                        <button class="settings-theme-option" type="button" data-theme-option="light"
                                            aria-pressed="false" aria-label="Light theme">
                                        <span class="settings-theme-preview" data-theme-preview="light" role="img"
                                            aria-label="Light theme preview">
                                            <span class="settings-theme-preview-sidebar" aria-hidden="true">
                                                <span class="settings-theme-preview-brand"></span>
                                                <span class="settings-theme-preview-nav settings-theme-preview-nav-active"></span>
                                                <span class="settings-theme-preview-nav"></span>
                                            </span>
                                            <span class="settings-theme-preview-main" aria-hidden="true">
                                                <span class="settings-theme-preview-messages">
                                                    <span class="settings-theme-preview-message"></span>
                                                    <span class="settings-theme-preview-response"></span>
                                                </span>
                                                <span class="settings-theme-preview-composer"></span>
                                            </span>
                                        </span>
                                        </button>
                                        <span class="settings-theme-option-label">Light</span>
                                    </div>
                                    <div class="settings-theme-choice">
                                        <button class="settings-theme-option" type="button" data-theme-option="dark"
                                            aria-pressed="false" aria-label="Dark theme">
                                        <span class="settings-theme-preview" data-theme-preview="dark" role="img"
                                            aria-label="Dark theme preview">
                                            <span class="settings-theme-preview-sidebar" aria-hidden="true">
                                                <span class="settings-theme-preview-brand"></span>
                                                <span class="settings-theme-preview-nav settings-theme-preview-nav-active"></span>
                                                <span class="settings-theme-preview-nav"></span>
                                            </span>
                                            <span class="settings-theme-preview-main" aria-hidden="true">
                                                <span class="settings-theme-preview-messages">
                                                    <span class="settings-theme-preview-message"></span>
                                                    <span class="settings-theme-preview-response"></span>
                                                </span>
                                                <span class="settings-theme-preview-composer"></span>
                                            </span>
                                        </span>
                                        </button>
                                        <span class="settings-theme-option-label">Dark</span>
                                    </div>
                                    <div class="settings-theme-choice">
                                        <button class="settings-theme-option" type="button" data-theme-option="system"
                                            aria-pressed="false" aria-label="Use system theme">
                                        <span class="settings-theme-preview" data-theme-preview="system" role="img"
                                            aria-label="System theme preview: light and dark">
                                            <span class="settings-theme-preview-system-half settings-theme-preview-system-light"
                                                aria-hidden="true">
                                                <span class="settings-theme-preview-sidebar">
                                                    <span class="settings-theme-preview-brand"></span>
                                                    <span class="settings-theme-preview-nav settings-theme-preview-nav-active"></span>
                                                    <span class="settings-theme-preview-nav"></span>
                                                </span>
                                                <span class="settings-theme-preview-main">
                                                    <span class="settings-theme-preview-messages">
                                                        <span class="settings-theme-preview-message"></span>
                                                        <span class="settings-theme-preview-response"></span>
                                                    </span>
                                                    <span class="settings-theme-preview-composer"></span>
                                                </span>
                                            </span>
                                            <span class="settings-theme-preview-system-half settings-theme-preview-system-dark"
                                                aria-hidden="true">
                                                <span class="settings-theme-preview-sidebar">
                                                    <span class="settings-theme-preview-brand"></span>
                                                    <span class="settings-theme-preview-nav settings-theme-preview-nav-active"></span>
                                                    <span class="settings-theme-preview-nav"></span>
                                                </span>
                                                <span class="settings-theme-preview-main">
                                                    <span class="settings-theme-preview-messages">
                                                        <span class="settings-theme-preview-message"></span>
                                                        <span class="settings-theme-preview-response"></span>
                                                    </span>
                                                    <span class="settings-theme-preview-composer"></span>
                                                </span>
                                            </span>
                                        </span>
                                        </button>
                                        <span class="settings-theme-option-label">Auto</span>
                                    </div>
                                </div>
                            </section>
                            <section class="settings-appearance-card" aria-label="Interface colors">
                                <div class="settings-custom-color-grid">
                                    <div class="settings-custom-color-row">
                                        <label class="settings-toggle-title" for="settings-color-accent">Accent</label>
                                        <div class="settings-color-control">
                                            <input class="settings-color-picker" type="color" aria-label="Pick accent color" data-color-picker="accent">
                                            <input class="settings-color-value" id="settings-color-accent" type="text"
                                                aria-label="Accent hex color" aria-describedby="settings-color-error-accent"
                                                placeholder="#RRGGBB" autocomplete="off" spellcheck="false" data-color-input="accent">
                                        </div>
                                        <p class="settings-color-error" id="settings-color-error-accent" role="status" hidden></p>
                                    </div>
                                    <div class="settings-custom-color-row">
                                        <label class="settings-toggle-title" for="settings-color-sidebar">Sidebar</label>
                                        <div class="settings-color-control">
                                            <input class="settings-color-picker" type="color" aria-label="Pick sidebar color" data-color-picker="sidebar">
                                            <input class="settings-color-value" id="settings-color-sidebar" type="text"
                                                aria-label="Sidebar hex color" aria-describedby="settings-color-error-sidebar"
                                                placeholder="#RRGGBB" autocomplete="off" spellcheck="false" data-color-input="sidebar">
                                        </div>
                                        <p class="settings-color-error" id="settings-color-error-sidebar" role="status" hidden></p>
                                    </div>
                                    <div class="settings-custom-color-row">
                                        <label class="settings-toggle-title" for="settings-color-background">Background</label>
                                        <div class="settings-color-control">
                                            <input class="settings-color-picker" type="color" aria-label="Pick background color" data-color-picker="background">
                                            <input class="settings-color-value" id="settings-color-background" type="text"
                                                aria-label="Background hex color" aria-describedby="settings-color-error-background"
                                                placeholder="#RRGGBB" autocomplete="off" spellcheck="false" data-color-input="background">
                                        </div>
                                        <p class="settings-color-error" id="settings-color-error-background" role="status" hidden></p>
                                    </div>
                                    <div class="settings-custom-color-row">
                                        <label class="settings-toggle-title" for="settings-color-foreground">Foreground</label>
                                        <div class="settings-color-control">
                                            <input class="settings-color-picker" type="color" aria-label="Pick foreground color" data-color-picker="foreground">
                                            <input class="settings-color-value" id="settings-color-foreground" type="text"
                                                aria-label="Foreground hex color" aria-describedby="settings-color-error-foreground"
                                                placeholder="#RRGGBB" autocomplete="off" spellcheck="false" data-color-input="foreground">
                                        </div>
                                        <p class="settings-color-error" id="settings-color-error-foreground" role="status" hidden></p>
                                    </div>
                                </div>
                                <div class="settings-color-reset-row">
                                    <button class="settings-color-reset" type="button" data-setting="reset-colors">Reset colors</button>
                                </div>
                            </section>
                        </section>
                        <section class="settings-page" data-page="shortcuts" hidden>
                            <h2 class="settings-section-title">Shortcut</h2>
                        </section>
                        <section class="settings-page" data-page="information"
                            aria-label="System information" hidden>
                            <div class="settings-version-banner" aria-label="ZEUS version information">
                                <div class="settings-version-copy">
                                    <span class="settings-version-value" aria-live="polite"></span>
                                </div>
                            </div>
                            <p class="settings-version-error" role="status" hidden>Could not load the ZEUS version.</p>
                            <div class="settings-info-grid" aria-label="System information" aria-live="polite">
                                <article class="settings-info-card settings-info-card-primary" data-info-card="zeus">
                                    <div class="settings-info-card-heading">
                                        <img class="settings-info-card-logo" src="/ZEUSbanner.png" alt="ZEUS">
                                    </div>
                                    <div class="settings-info-card-value">Loading...</div>
                                    <div class="settings-info-card-detail">Application version</div>
                                </article>
                                <article class="settings-info-card settings-info-card-primary" data-info-card="searxng">
                                    <div class="settings-info-card-heading">
                                        <span>SearXNG</span>
                                    </div>
                                    <div class="settings-info-card-value">Loading...</div>
                                    <div class="settings-info-card-detail">Search service status</div>
                                </article>
                                <div class="settings-info-runtime">
                                    <section class="settings-info-runtime-section" aria-label="Node.js dependencies">
                                        <div class="settings-info-runtime-item" data-info-runtime="node">
                                            <span class="settings-info-runtime-name">
                                                <span class="settings-info-runtime-label">Node.js</span>
                                            </span>
                                            <span class="settings-info-runtime-value">Loading...</span>
                                        </div>
                                        <ul class="settings-info-dependencies" data-runtime-dependencies="node">
                                            <li>Loading...</li>
                                        </ul>
                                    </section>
                                    <section class="settings-info-runtime-section" aria-label="Python dependencies">
                                        <div class="settings-info-runtime-item" data-info-runtime="python">
                                            <span class="settings-info-runtime-name">
                                                <span class="settings-info-runtime-label">Python</span>
                                            </span>
                                            <span class="settings-info-runtime-value">Loading...</span>
                                        </div>
                                        <ul class="settings-info-dependencies" data-runtime-dependencies="python">
                                            <li>Loading...</li>
                                        </ul>
                                    </section>
                                </div>
                            </div>
                            <div class="settings-info-runtime settings-info-project" aria-label="Project documents">
                                <button class="settings-info-runtime-item settings-info-project-item"
                                    type="button" data-project-doc="CONTRIBUTING.md">
                                    <span class="settings-info-runtime-name">
                                        <span class="settings-info-runtime-label">Contributing</span>
                                    </span>
                                    <span class="settings-info-project-arrow" aria-hidden="true">›</span>
                                </button>
                                <button class="settings-info-runtime-item settings-info-project-item"
                                    type="button" data-project-doc="SECURITY.md">
                                    <span class="settings-info-runtime-name">
                                        <span class="settings-info-runtime-label">Security</span>
                                    </span>
                                    <span class="settings-info-project-arrow" aria-hidden="true">›</span>
                                </button>
                                <button class="settings-info-runtime-item settings-info-project-item"
                                    type="button" data-project-doc="PRIVACY.md">
                                    <span class="settings-info-runtime-name">
                                        <span class="settings-info-runtime-label">Privacy</span>
                                    </span>
                                    <span class="settings-info-project-arrow" aria-hidden="true">›</span>
                                </button>
                            </div>
                            <p class="settings-info-license">
                                ZEUS is powered GNU GPL v3.0 License, for more information
                                <a href="https://www.gnu.org/licenses/gpl-3.0"
                                    target="_blank" rel="noopener noreferrer">click here</a>.
                            </p>
                        </section>
                    </div>
                    <div class="chat-scrollbar" role="scrollbar" tabindex="-1"
                        aria-label="Settings page scroll position" aria-controls="settings-content"
                        aria-orientation="vertical" aria-valuemin="0" aria-valuemax="1000"
                        aria-valuenow="0">
                        <div class="chat-scrollbar-thumb"></div>
                    </div>
                    </div>
                    <dialog class="settings-doc-dialog" aria-labelledby="settings-doc-dialog-title">
                        <header class="settings-doc-dialog-header">
                            <h2 class="settings-doc-dialog-title" id="settings-doc-dialog-title"></h2>
                            <button class="settings-close settings-doc-dialog-close" type="button"
                                aria-label="Close document">×</button>
                        </header>
                        <div class="settings-doc-dialog-body">
                            <div class="settings-doc-dialog-content chat-scroll" id="settings-doc-dialog-content"
                                aria-live="polite"></div>
                            <div class="chat-scrollbar" role="scrollbar" tabindex="-1"
                                aria-label="Document scroll position" aria-controls="settings-doc-dialog-content"
                                aria-orientation="vertical" aria-valuemin="0" aria-valuemax="1000"
                                aria-valuenow="0">
                                <div class="chat-scrollbar-thumb"></div>
                            </div>
                        </div>
                    </dialog>
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
    const searchResultsScrollbar = dialog.querySelector('.settings-search-wrap .chat-scrollbar');
    const searchResultsScroll = initializeScrollbar({
        scrollElement: searchResults,
        scrollbar: searchResultsScrollbar,
        thumb: searchResultsScrollbar.querySelector('.chat-scrollbar-thumb'),
        layoutTrack() {
            const resultsBounds = searchResults.getBoundingClientRect();
            const wrapBounds = settingsSearch.parentElement.getBoundingClientRect();
            searchResultsScrollbar.style.top = `${resultsBounds.top - wrapBounds.top}px`;
            searchResultsScrollbar.style.height = `${resultsBounds.height}px`;
        },
        onScrollableChange(isScrollable) {
            searchResults.classList.toggle('is-scrollable', isScrollable);
        },
        observe: [settingsSearch.parentElement],
    });
    const settingsContent = dialog.querySelector('.settings-content');
    const settingsScrollbar = dialog.querySelector('.settings-content-wrap > .chat-scrollbar');
    const settingsContentScroll = initializeScrollbar({
        scrollElement: settingsContent,
        scrollbar: settingsScrollbar,
        thumb: settingsScrollbar.querySelector('.chat-scrollbar-thumb'),
        observe: [...settingsContent.querySelectorAll('.settings-page'), modelList],
    });
    const versionValue = dialog.querySelector('.settings-version-value');
    const versionError = dialog.querySelector('.settings-version-error');
    const infoCards = dialog.querySelectorAll('[data-info-card]');
    if (initialVersion) {
        versionValue.textContent = initialVersion;
        const zeusCard = dialog.querySelector('[data-info-card="zeus"]');
        zeusCard.querySelector('.settings-info-card-value').textContent = initialVersion;
    }
    const infoRuntimeItems = dialog.querySelectorAll('[data-info-runtime]');
    const infoRuntimeDependencies = dialog.querySelectorAll('[data-runtime-dependencies]');
    const projectDocs = dialog.querySelectorAll('[data-project-doc]');
    const projectDocDialog = dialog.querySelector('.settings-doc-dialog');
    const projectDocTitle = dialog.querySelector('.settings-doc-dialog-title');
    const projectDocContent = dialog.querySelector('.settings-doc-dialog-content');
    const projectDocScrollbar = dialog.querySelector('.settings-doc-dialog .chat-scrollbar');
    const projectDocScrollbarThumb = projectDocScrollbar.querySelector('.chat-scrollbar-thumb');
    const projectDocScroll = initializeScrollbar({
        scrollElement: projectDocContent,
        scrollbar: projectDocScrollbar,
        thumb: projectDocScrollbarThumb,
    });
    let catalogModels = [];
    let searchEnabled = readPreference('zeus.webui.search_tool', true);
    const themeOptions = dialog.querySelectorAll('[data-theme-option]');
    const colorInputs = dialog.querySelectorAll('[data-color-input]');
    const colorPickers = dialog.querySelectorAll('[data-color-picker]');
    const customColors = {
        accent: readStringPreference(
            'zeus.webui.custom_color',
            value => /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value),
            '',
        ),
        sidebar: readStringPreference(
            'zeus.webui.custom_sidebar_color',
            value => /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value),
            '',
        ),
        background: readStringPreference(
            'zeus.webui.custom_background_color',
            value => /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value),
            '',
        ),
        foreground: readStringPreference(
            'zeus.webui.custom_foreground_color',
            value => /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value),
            '',
        ),
    };
    let selectedTheme = readStringPreference(
        'zeus.webui.theme',
        value => ['light', 'dark', 'system', 'zeus'].includes(value),
        'system',
    );
    if (selectedTheme === 'zeus') {
        selectedTheme = 'system';
        writePreference('zeus.webui.theme', selectedTheme);
    }
    const systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');

    function setToggle(button, checked) {
        button.setAttribute('aria-checked', String(checked));
    }

    projectDocDialog.addEventListener('close', () => {
        projectDocScroll.hide();
    });

    for (const doc of projectDocs) {
        doc.addEventListener('click', async () => {
            projectDocTitle.textContent = {
                'CONTRIBUTING.md': 'Contributing',
                'SECURITY.md': 'Security',
                'PRIVACY.md': 'Privacy',
            }[doc.dataset.projectDoc];
            projectDocContent.textContent = 'Loading document...';
            projectDocDialog.showModal();
            try {
                const response = await fetch(`/project-docs/${encodeURIComponent(doc.dataset.projectDoc)}`);
                if (!response.ok) throw new Error(`Request failed (${response.status}).`);
                const markdown = await response.text();
                if (typeof globalThis.markdownit !== 'function') {
                    throw new Error('Markdown renderer is unavailable.');
                }
                const rendered = globalThis.markdownit({
                    html: false,
                    linkify: false,
                    breaks: true,
                }).render(markdown);
                projectDocContent.innerHTML = sanitizeHtml(rendered);
                projectDocScroll.update();
            } catch (error) {
                console.error(`Could not load ${doc.dataset.projectDoc}:`, error);
                projectDocContent.textContent = `Could not load document: ${error.message}`;
            }
        });
    }
    dialog.querySelector('.settings-doc-dialog-close').addEventListener('click', () => (
        projectDocDialog.close()
    ));

    async function loadSystemInfo() {
        try {
            const response = await fetch('/api/about');
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
            if (!result.zeus?.value) throw new Error('The ZEUS version is missing from system information.');
            versionValue.textContent = result.zeus.value;
            versionError.hidden = true;
            for (const card of infoCards) {
                const info = result[card.dataset.infoCard];
                card.querySelector('.settings-info-card-value').textContent = info.value;
                card.querySelector('.settings-info-card-detail').textContent = info.detail;
            }
            for (const item of infoRuntimeItems) {
                item.querySelector('.settings-info-runtime-value').textContent = (
                    result[item.dataset.infoRuntime].version
                );
            }
            for (const list of infoRuntimeDependencies) {
                const dependencies = result[list.dataset.runtimeDependencies]?.dependencies;
                list.replaceChildren();
                if (!Array.isArray(dependencies) || dependencies.length === 0) {
                    const item = document.createElement('li');
                    item.textContent = 'Unavailable';
                    list.append(item);
                    continue;
                }
                for (const dependency of dependencies) {
                    const item = document.createElement('li');
                    item.className = 'settings-info-dependency';
                    const name = document.createElement('span');
                    name.className = 'settings-info-dependency-name';
                    name.textContent = dependency.name;
                    const version = document.createElement('span');
                    version.className = 'settings-info-dependency-version';
                    version.textContent = dependency.version;
                    item.append(name, version);
                    list.append(item);
                }
            }
        } catch (error) {
            console.error('Could not load system information:', error);
            if (!initialVersion) {
                versionValue.textContent = 'Unavailable';
                versionError.hidden = false;
            }
            for (const card of infoCards) {
                if (initialVersion && card.dataset.infoCard === 'zeus') continue;
                card.querySelector('.settings-info-card-value').textContent = 'Unavailable';
                card.querySelector('.settings-info-card-detail').textContent = 'Could not load system information.';
            }
            for (const item of infoRuntimeItems) {
                item.querySelector('.settings-info-runtime-value').textContent = 'Unavailable';
            }
            for (const list of infoRuntimeDependencies) {
                list.textContent = 'Unavailable';
            }
        }
    }

    void loadSystemInfo();

    function applyTheme() {
        const resolvedTheme = selectedTheme === 'system'
            ? (systemThemeQuery.matches ? 'dark' : 'light')
            : selectedTheme;
        const defaultColors = resolvedTheme === 'dark'
            ? {
                accent: '#1d4ed8',
                sidebar: '#191919',
                background: '#000000',
                foreground: '#ededed',
            }
            : {
                accent: '#1d4ed8',
                sidebar: '#ffffff',
                background: '#f5f5f5',
                foreground: '#222222',
            };
        document.documentElement.dataset.themeMode = resolvedTheme;
        const temporaryChat = document.body.classList.contains('temp-chat-mode');
        document.body.dataset.themeMode = temporaryChat ? 'dark' : resolvedTheme;
        for (const [name, defaultColor] of Object.entries(defaultColors)) {
            const color = customColors[name] || defaultColor;
            document.documentElement.style.setProperty(`--user-${name}`, color);
            document.body.style.setProperty(
                `--user-${name}`,
                temporaryChat ? TEMPORARY_THEME_COLORS[name] : color,
            );
            const input = dialog.querySelector(`[data-color-input="${name}"]`);
            const picker = dialog.querySelector(`[data-color-picker="${name}"]`);
            if (document.activeElement !== input) input.value = color;
            picker.value = toPickerHex(color);
        }
        document.querySelector('meta[name="theme-color"]').content = (
            customColors.background || defaultColors.background
        );
        for (const option of themeOptions) {
            option.setAttribute('aria-pressed', String(option.dataset.themeOption === selectedTheme));
        }
    }

    function toPickerHex(color) {
        let digits = color.slice(1);
        if (digits.length === 3 || digits.length === 4) {
            digits = [...digits.slice(0, 3)].map(digit => digit + digit).join('');
        }
        return `#${digits.slice(0, 6)}`;
    }

    const colorPreferenceKeys = {
        accent: 'zeus.webui.custom_color',
        sidebar: 'zeus.webui.custom_sidebar_color',
        background: 'zeus.webui.custom_background_color',
        foreground: 'zeus.webui.custom_foreground_color',
    };

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
        const informationPage = dialog.querySelector('[data-page="information"]');
        informationPage.classList.remove('settings-info-enter');
        if (sectionId === 'information') {
            void informationPage.offsetWidth;
            informationPage.classList.add('settings-info-enter');
        }
    }

    function closeSearchResults() {
        searchResults.hidden = true;
        searchResultsScroll.update();
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
        searchResultsScroll.update();
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
    function openSection(sectionId) {
        if (!dialog.open) dialog.showModal();
        activateSection(sectionId);
        if (sectionId === 'models') {
            void refreshModelData().catch(error => (
                window.alert(`Could not load model catalog: ${error.message}`)
            ));
        }
    }
    openButton?.addEventListener('click', () => openSection('models'));
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

    applyTheme();
    for (const option of themeOptions) {
        option.addEventListener('click', () => {
            selectedTheme = option.dataset.themeOption;
            writePreference('zeus.webui.theme', selectedTheme);
            applyTheme();
        });
    }
    for (const input of colorInputs) {
        const name = input.dataset.colorInput;
        const error = dialog.querySelector(`#settings-color-error-${name}`);
        const picker = dialog.querySelector(`[data-color-picker="${name}"]`);
        const applyColor = value => {
            customColors[name] = value;
            writePreference(colorPreferenceKeys[name], value);
            error.hidden = true;
            error.textContent = '';
            input.setAttribute('aria-invalid', 'false');
            applyTheme();
        };
        input.addEventListener('input', () => {
            const value = input.value.trim();
            if (value === '') {
                applyColor('');
                return;
            }
            if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)) {
                error.textContent = 'Use #RGB, #RGBA, #RRGGBB, or #RRGGBBAA.';
                error.hidden = false;
                input.setAttribute('aria-invalid', 'true');
                return;
            }
            applyColor(value);
        });
        picker.addEventListener('input', () => applyColor(picker.value));
    }
    dialog.querySelector('[data-setting="reset-colors"]').addEventListener('click', () => {
        for (const name of Object.keys(colorPreferenceKeys)) {
            customColors[name] = '';
            writePreference(colorPreferenceKeys[name], '');
        }
        for (const input of colorInputs) {
            input.setAttribute('aria-invalid', 'false');
        }
        for (const error of dialog.querySelectorAll('.settings-color-error')) {
            error.hidden = true;
            error.textContent = '';
        }
        applyTheme();
    });
    systemThemeQuery.addEventListener('change', () => {
        if (selectedTheme === 'system') applyTheme();
    });

    return {
        isSearchEnabled: () => searchEnabled,
        openSection,
    };
}
