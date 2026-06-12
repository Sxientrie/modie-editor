import { escapeHtml } from './utils.js';
import { renderMarkdown } from './markdown.js';
import * as api from './api.js';
import * as ui from './ui.js';
import { setupGestures } from './gestures.js';
import { setupEditor } from './editor.js';
import { setupContextMenu } from './contextmenu.js';
import { initWatch, startWatching, stopWatching } from './watch.js';
import { initTabs, renderTabs, saveCurrentTabState, switchToFile, closeTab, openFile, closeFile } from './tabs.js';
import { initSettingsModule, syncSettingsToServer, initSettings } from './settings.js';
import { setupBrowser } from './api-browser.js';
import { setupFind } from './ui-find.js';
import { setupOutline, toggleOutline } from './ui-outline.js';
import { setupGlobalReplace } from './ui-replace.js';
import { initOfflineSync } from './indexeddb-sync.js';
import { initGit } from './git.js';

const getLS = (k) => localStorage.getItem(k) === 'true';

const listeners = [];
const subscribe = (fn) => { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i > -1) listeners.splice(i, 1); }; };

const makeDeepProxy = (obj, handler) => {
    if (typeof obj !== 'object' || obj === null) return obj;
    for (let k in obj) { if (typeof obj[k] === 'object' && obj[k] !== null) obj[k] = makeDeepProxy(obj[k], handler); }
    return new Proxy(obj, handler);
};

const stateHandler = {
    set(target, prop, value) {
        if (target[prop] === value) return true;
        target[prop] = (typeof value === 'object' && value !== null) ? makeDeepProxy(value, stateHandler) : value;
        listeners.forEach(fn => { try { fn(prop, value, target); } catch (e) {} });
        return true;
    }
};

const rawState = {
    originalContent: '', isDirty: false, currentTab: 'browser', pendingRestore: null, findMatches: [], findIndex: -1,
    activeFilePath: null, activeFileModified: null, currentPath: '', findCaseSensitive: getLS('find_case_sensitive'),
    findWholeWord: getLS('find_whole_word'), findRegex: getLS('find_regex'), globalSearchCaseSensitive: getLS('global_search_case_sensitive'),
    globalSearchRegex: getLS('global_search_regex'), contextItem: null, savedSelectionStart: null, savedSelectionEnd: null,
    savedScrollTop: null, currentBackupContent: null, openFiles: {}
};

const state = makeDeepProxy(rawState, stateHandler);

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const tabPanels = { 'browser': 'panelBrowser', 'edit': 'panelEdit', 'preview': 'panelPreview', 'backups': 'panelBackups', 'git': 'panelGit' };

const ctx = {
    state, editor: $('#editor'), lineNumbers: $('#lineNumbers'), preview: $('#preview'), cursorPos: $('#cursorPos'),
    wordCount: $('#wordCount'), findBar: $('#findBar'), findInput: $('#findInput'), findCount: $('#findCount'),
    setStatus: ui.setStatus, toast: ui.toast, updateLineNumbers: () => ui.updateLineNumbers(ctx),
    updateWordCount: () => ui.updateWordCount(ctx), formatBytes: ui.formatBytes, switchTab,
    checkDraft: () => ui.checkDraft(ctx), clearDraft: () => ui.clearDraft(ctx), updateCursorPos: () => ui.updateCursorPos(ctx),
    openFile, showConfirm, showPrompt, renderMarkdown, renderTabs, closeTab, switchToFile, stopWatching, startWatching, subscribe
};

function showConfirm(title, message) {
    return new Promise((resolve) => {
        const modal = $('#genericConfirmModal'), titleEl = $('#genericConfirmTitle'), textEl = $('#genericConfirmText');
        const btnCancel = $('#btnGenericConfirmCancel'), btnConfirm = $('#btnGenericConfirmConfirm');
        titleEl.textContent = title; textEl.textContent = message; modal.classList.add('active');
        history.pushState({ modal: 'genericConfirmModal' }, '');
        const cleanup = (res) => {
            modal.classList.remove('active');
            btnCancel.removeEventListener('click', onCancel);
            btnConfirm.removeEventListener('click', onConfirm);
            modal.removeEventListener('click', onOverlay);
            if (history.state && history.state.modal === 'genericConfirmModal') history.back();
            resolve(res);
        };
        const onCancel = () => cleanup(false), onConfirm = () => cleanup(true), onOverlay = (e) => { if (e.target === modal) cleanup(false); };
        btnCancel.addEventListener('click', onCancel);
        btnConfirm.addEventListener('click', onConfirm);
        modal.addEventListener('click', onOverlay);
    });
}

function showPrompt(title, message, defaultValue = '') {
    return new Promise((resolve) => {
        const modal = $('#genericPromptModal'), titleEl = $('#genericPromptTitle'), textEl = $('#genericPromptText');
        const inputEl = $('#genericPromptInput'), btnCancel = $('#btnGenericPromptCancel'), btnConfirm = $('#btnGenericPromptConfirm');
        titleEl.textContent = title; textEl.textContent = message; inputEl.value = defaultValue;
        modal.classList.add('active'); history.pushState({ modal: 'genericPromptModal' }, '');
        setTimeout(() => inputEl.focus(), 100);
        const cleanup = (res) => {
            modal.classList.remove('active');
            btnCancel.removeEventListener('click', onCancel);
            btnConfirm.removeEventListener('click', onConfirm);
            inputEl.removeEventListener('keydown', onKeyDown);
            modal.removeEventListener('click', onOverlay);
            if (history.state && history.state.modal === 'genericPromptModal') history.back();
            resolve(res);
        };
        const onCancel = () => cleanup(null), onConfirm = () => cleanup(inputEl.value.trim()), onKeyDown = (e) => { if (e.key === 'Enter') { e.preventDefault(); onConfirm(); } }, onOverlay = (e) => { if (e.target === modal) cleanup(null); };
        btnCancel.addEventListener('click', onCancel);
        btnConfirm.addEventListener('click', onConfirm);
        inputEl.addEventListener('keydown', onKeyDown);
        modal.addEventListener('click', onOverlay);
    });
}

function switchTab(name) {
    if (!tabPanels[name]) return;
    state.currentTab = name;
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.panel === name));
    const isTablet = window.innerWidth >= 768;
    $$('.panel').forEach(p => {
        if (isTablet && (name === 'edit' || name === 'preview') && (p.id === 'panelEdit' || p.id === 'panelPreview')) {
            p.style.display = 'flex';
            p.classList.add('panel-split-active');
        } else {
            p.style.display = p.id === tabPanels[name] ? 'flex' : 'none';
            p.classList.remove('panel-split-active');
        }
    });
    const toolbar = $('#formatToolbar');
    if (toolbar) toolbar.style.display = name === 'edit' ? 'flex' : 'none';
    if (name === 'preview' && state.activeFilePath) ctx.preview.innerHTML = renderMarkdown(ctx.editor.value);
    if (isTablet && name === 'edit' && state.activeFilePath) ctx.preview.innerHTML = renderMarkdown(ctx.editor.value);
    if (name === 'backups' && state.activeFilePath) api.loadBackups(ctx, state.activeFilePath);
}

$$('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.panel)));

$('#btnRestoreCancel').addEventListener('click', () => {
    $('#restoreModal').classList.remove('active');
    state.pendingRestore = null;
    if (history.state && history.state.modal === 'restoreModal') history.back();
});
$('#restoreModal').addEventListener('click', (e) => {
    if (e.target === $('#restoreModal')) {
        $('#restoreModal').classList.remove('active');
        state.pendingRestore = null;
        if (history.state && history.state.modal === 'restoreModal') history.back();
    }
});
$('#btnRestoreConfirm').addEventListener('click', () => {
    $('#restoreModal').classList.remove('active');
    if (history.state && history.state.modal === 'restoreModal') history.back();
    if (state.pendingRestore && state.activeFilePath) {
        api.performRestore(ctx, state.pendingRestore, state.activeFilePath);
        state.pendingRestore = null;
    }
});

window.addEventListener('beforeunload', (e) => {
    if (state.isDirty) { e.preventDefault(); e.returnValue = ''; }
});

function runGlobalSearch() {
    const query = $('#globalSearchInput').value.trim();
    if (!query) {
        $('#globalSearchCount').textContent = '';
        api.loadDirectory(ctx, state.currentPath);
        return;
    }
    api.searchFiles(ctx, query, state.currentPath, state.globalSearchCaseSensitive, state.globalSearchRegex);
}

$('#btnGlobalSearchToggle').addEventListener('click', () => {
    const searchBar = $('#browserSearchBar');
    const toggleBtn = $('#btnGlobalSearchToggle');
    const filterBar = $('#browserFilterBar');
    const filterBtn = $('#btnBrowserFilterToggle');
    
    if (searchBar) {
        const isActive = searchBar.classList.toggle('active');
        toggleBtn.classList.toggle('active', isActive);
        
        if (isActive) {
            if (filterBar) {
                filterBar.classList.remove('active');
                filterBtn.classList.remove('active');
                $('#browserFilterInput').value = '';
                ui.filterBrowserItems('');
            }
            
            const searchInput = $('#globalSearchInput');
            searchInput.value = '';
            $('#globalSearchCount').textContent = '';
            searchInput.focus();
        } else {
            $('#globalSearchInput').value = '';
            $('#globalSearchCount').textContent = '';
            api.loadDirectory(ctx, state.currentPath);
        }
    }
});

$('#btnBrowserSearchClear').addEventListener('click', () => {
    const searchInput = $('#globalSearchInput');
    if (searchInput) searchInput.value = '';
    $('#globalSearchCount').textContent = '';
    
    const searchBar = $('#browserSearchBar');
    if (searchBar) searchBar.classList.remove('active');
    $('#btnGlobalSearchToggle').classList.remove('active');
    
    api.loadDirectory(ctx, state.currentPath);
});

let globalSearchTimeout = null;
$('#globalSearchInput').addEventListener('input', () => {
    clearTimeout(globalSearchTimeout);
    globalSearchTimeout = setTimeout(runGlobalSearch, 300);
});
$('#globalSearchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') $('#btnBrowserSearchClear').click();
    else if (e.key === 'Enter') { e.preventDefault(); runGlobalSearch(); }
});
$('#btnGlobalSearchCase').addEventListener('click', () => {
    state.globalSearchCaseSensitive = !state.globalSearchCaseSensitive;
    localStorage.setItem('global_search_case_sensitive', state.globalSearchCaseSensitive);
    $('#btnGlobalSearchCase').classList.toggle('active', state.globalSearchCaseSensitive);
    runGlobalSearch();
});
$('#btnGlobalSearchRegex').addEventListener('click', () => {
    state.globalSearchRegex = !state.globalSearchRegex;
    localStorage.setItem('global_search_regex', state.globalSearchRegex);
    $('#btnGlobalSearchRegex').classList.toggle('active', state.globalSearchRegex);
    runGlobalSearch();
});
$('#btnNewFile').addEventListener('click', async () => {
    const name = await ctx.showPrompt('New File', 'New file name (e.g. notes.md):');
    if (name) api.createItem(ctx, state.currentPath, name, false).then(() => api.loadDirectory(ctx, state.currentPath));
});
$('#btnNewFolder').addEventListener('click', async () => {
    const name = await ctx.showPrompt('New Folder', 'New folder name:');
    if (name) api.createItem(ctx, state.currentPath, name, true).then(() => api.loadDirectory(ctx, state.currentPath));
});
$('#browserBreadcrumbs').addEventListener('click', (e) => {
    const item = e.target.closest('.breadcrumb-item');
    if (item) api.loadDirectory(ctx, item.dataset.path);
});

$('#btnBack').addEventListener('click', () => {
    if (state.activeFilePath) {
        closeTab(state.activeFilePath);
    } else {
        $('#btnBack').style.display = 'none';
        $('#logoIcon').style.display = 'flex';
        $('#headerTitle').textContent = 'MODiE';
        $('#headerSubtitle').textContent = 'Browser';
        switchTab('browser');
        api.loadDirectory(ctx, state.currentPath);
    }
});

$('#drawerOverlay').addEventListener('click', () => {
    const outline = $('#outlineDrawer'), settings = $('#settingsDrawer');
    if (outline && outline.classList.contains('active')) toggleOutline(ctx);
    if (settings && settings.classList.contains('active')) ui.toggleSettings(ctx);
});

$('#authTokenInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        $('#btnAuthSubmit').click();
    }
});

const urlParams = new URLSearchParams(window.location.search);
if (urlParams.has('token')) {
    localStorage.setItem('editor_token', urlParams.get('token'));
    window.history.replaceState({}, document.title, window.location.pathname);
}

const btnBrowserGit = $('#btnBrowserGit');
if (btnBrowserGit) {
    btnBrowserGit.addEventListener('click', () => {
        $('#btnBack').style.display = 'inline-flex';
        $('#logoIcon').style.display = 'none';
        $('#headerTitle').textContent = 'Git Repository';
        $('#headerSubtitle').textContent = 'Version Control';
        switchTab('git');
    });
}

initSettingsModule(ctx, state, closeFile);
initWatch(ctx, state); initTabs(ctx, state, startWatching, stopWatching, switchTab); initSettings();
setupBrowser(ctx, state); setupFind(ctx); setupOutline(ctx); setupGlobalReplace(ctx); initOfflineSync(ctx);
initGit(ctx, state);
ui.setupPreviewCheckboxSync(ctx);

function closeActiveModal() {
    const modalIds = [
        'genericConfirmModal', 'genericPromptModal', 'contextMenuModal',
        'aboutModal', 'previewBackupModal', 'externalChangeModal',
        'restoreModal', 'diffModal', 'draftModal'
    ];
    for (const id of modalIds) {
        const m = $('#' + id);
        if (m && m.classList.contains('active')) {
            m.classList.remove('active');
            return true;
        }
    }
    return false;
}

window.addEventListener('popstate', () => {
    if (closeActiveModal()) return;
    const outline = $('#outlineDrawer');
    const settings = $('#settingsDrawer');
    const overlay = $('#drawerOverlay');
    if (outline && outline.classList.contains('active')) outline.classList.remove('active');
    if (settings && settings.classList.contains('active')) settings.classList.remove('active');
    if (overlay) overlay.classList.remove('active');
});

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js');
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!refreshing) {
            refreshing = true;
            window.location.reload();
        }
    });
}

document.addEventListener('contextmenu', e => {
    if (e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'INPUT' && !e.target.closest('#preview')) e.preventDefault();
});

setupEditor(ctx, state, ui, api);
setupContextMenu(ctx, state, api, ui);
setupGestures(ctx, state, switchTab);

window.addEventListener('unhandledrejection', (e) => {
    const msg = e.reason && e.reason.message ? e.reason.message.slice(0, 60) : 'Unknown error';
    ui.toast(`Error: ${msg}`, 'error');
});
