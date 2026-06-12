import { escapeHtml } from './utils.js';

export { toggleFind, doFind, handleFormat, doReplace, doReplaceAll } from './ui-find.js';
import { updateActiveHeading, toggleOutline, populateOutline } from './ui-outline.js';
export { toggleOutline, populateOutline, updateActiveHeading };

const THEME_KEY = 'modie_theme';
const ZOOM_MIN = 12, ZOOM_MAX = 28, ZOOM_STEP = 2, ZOOM_DEFAULT = 14;
const ZOOM_KEY = 'modie_zoom';
const DENSITY_KEY = 'modie_density';

export function getTheme() { return localStorage.getItem(THEME_KEY) || 'dark'; }
export function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
    document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#09090b' : '#ffffff';
}
export function getDensity() { return localStorage.getItem(DENSITY_KEY) || 'normal'; }
export function applyDensity(density) {
    const list = document.querySelector('#browserList');
    if (list) {
        list.classList.remove('density-compact', 'density-normal', 'density-large');
        list.classList.add(`density-${density}`);
    }
    localStorage.setItem(DENSITY_KEY, density);
}
export function toast(message, type = 'info') {
    const container = document.querySelector('#toastContainer');
    if (!container) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span class="toast-dot"></span>${escapeHtml(message)}`;
    container.appendChild(el);
    setTimeout(() => el.remove(), 3000);
}
export function setStatus(status, text) {
    const statusDot = document.querySelector('#statusDot');
    const statusText = document.querySelector('#statusText');
    if (statusDot) statusDot.className = `status-dot ${status}`;
    if (statusText) statusText.textContent = text;
}
export function updateDirtyState(ctx) {
    const wasDirty = ctx.state.isDirty;
    ctx.state.isDirty = ctx.editor.value !== ctx.state.originalContent;
    if (ctx.state.activeFilePath && ctx.state.openFiles && ctx.state.openFiles[ctx.state.activeFilePath]) {
        ctx.state.openFiles[ctx.state.activeFilePath].isDirty = ctx.state.isDirty;
        ctx.state.openFiles[ctx.state.activeFilePath].content = ctx.editor.value;
    }
    if (wasDirty !== ctx.state.isDirty) {
        if (ctx.renderTabs) ctx.renderTabs();
    }
    if (ctx.state.isDirty) {
        setStatus('unsaved', 'Unsaved changes');
        document.title = '\u25cf MODiE';
    } else {
        setStatus('saved', 'Saved');
        document.title = 'MODiE';
    }
}
export function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
}
let lastLineCount = 0;
let lastLineNumbersText = '';
export function updateLineNumbers(ctx) {
    const lines = ctx.editor.value.split('\n').length;
    if (lines === lastLineCount) return;
    if (lines > lastLineCount) {
        for (let i = lastLineCount + 1; i <= lines; i++) lastLineNumbersText += i + '\n';
    } else {
        let pos = -1;
        for (let i = 0; i < lines; i++) pos = lastLineNumbersText.indexOf('\n', pos + 1);
        lastLineNumbersText = lastLineNumbersText.substring(0, pos + 1);
    }
    lastLineCount = lines;
    ctx.lineNumbers.textContent = lastLineNumbersText;
}
export function syncScroll(ctx) {
    ctx.lineNumbers.style.transform = `translateY(-${ctx.editor.scrollTop}px)`;
}
export function updateCursorPos(ctx) {
    const val = ctx.editor.value;
    const pos = ctx.editor.selectionStart;
    const before = val.substring(0, pos);
    const line = before.split('\n').length;
    const col = pos - before.lastIndexOf('\n');
    ctx.cursorPos.textContent = `Ln ${line}, Col ${col}`;
    updateActiveHeading(ctx);
}
export function getZoom() {
    const s = localStorage.getItem(ZOOM_KEY);
    return s ? parseInt(s, 10) : ZOOM_DEFAULT;
}
export function applyZoom(ctx, size) {
    size = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, size));
    localStorage.setItem(ZOOM_KEY, size);
    ctx.editor.style.fontSize = size + 'px';
    ctx.lineNumbers.style.fontSize = (size - 1) + 'px';
    ctx.preview.style.fontSize = size + 'px';
    ctx.lineNumbers.style.lineHeight = getComputedStyle(ctx.editor).lineHeight;
}
export function getWordWrap() { return localStorage.getItem('word_wrap') !== 'false'; }
export function applyWordWrap(ctx, enabled) {
    localStorage.setItem('word_wrap', enabled);
    ctx.editor.setAttribute('wrap', enabled ? 'soft' : 'off');
    if (enabled) {
        ctx.editor.style.whiteSpace = 'pre-wrap';
        ctx.editor.style.wordBreak = 'break-word';
        ctx.editor.style.overflowWrap = 'break-word';
    } else {
        ctx.editor.style.whiteSpace = 'pre';
        ctx.editor.style.wordBreak = 'normal';
        ctx.editor.style.overflowWrap = 'normal';
    }
}
let saveDraftTimeout = null;
export function handleAutoSave(ctx) {
    if (!ctx.state.activeFilePath) return;
    if (saveDraftTimeout) clearTimeout(saveDraftTimeout);
    const delayVal = localStorage.getItem('auto_save_delay');
    const delay = delayVal !== null ? parseInt(delayVal, 10) : 500;
    const key = `modie_draft_${ctx.state.activeFilePath}`;
    if (delay === 0) {
        localStorage.removeItem(key);
        return;
    }
    saveDraftTimeout = setTimeout(() => {
        if (ctx.editor.value !== ctx.state.originalContent) {
            const payload = JSON.stringify({ path: ctx.state.activeFilePath, content: ctx.editor.value });
            try { localStorage.setItem(key, payload); } catch (e) {}
        } else {
            localStorage.removeItem(key);
        }
    }, delay);
}
export function clearDraft(ctx) {
    if (ctx && ctx.state && ctx.state.activeFilePath) {
        localStorage.removeItem(`modie_draft_${ctx.state.activeFilePath}`);
    }
}
export function checkDraft(ctx) {
    if (!ctx.state.activeFilePath) return;
    const raw = localStorage.getItem(`modie_draft_${ctx.state.activeFilePath}`);
    if (!raw) return;
    try {
        const draft = JSON.parse(raw);
        if (draft.path === ctx.state.activeFilePath && draft.content !== ctx.editor.value) {
            const modal = document.querySelector('#draftModal');
            if (modal) {
                modal.classList.add('active');
                history.pushState({ modal: 'draftModal' }, '');
            }
        }
    } catch (e) {
        clearDraft(ctx);
    }
}
export function toggleSettings(ctx) {
    const drawer = document.querySelector('#settingsDrawer');
    const overlay = document.querySelector('#drawerOverlay');
    if (!drawer || !overlay) return;
    const outlineDrawer = document.querySelector('#outlineDrawer');
    if (outlineDrawer) outlineDrawer.classList.remove('active');
    const active = drawer.classList.toggle('active');
    overlay.classList.toggle('active', active);
    if (active) {
        populateSettings(ctx);
        history.pushState({ drawer: 'settings' }, '');
    } else {
        if (history.state && history.state.drawer === 'settings') {
            history.back();
        }
    }
}
export function populateSettings(ctx) {
    const showHidden = localStorage.getItem('show_hidden') === 'true';
    const showAll = localStorage.getItem('show_all') === 'true';
    const wordWrap = getWordWrap();
    const theme = getTheme();
    const zoom = getZoom();
    const density = getDensity();
    const autoSaveDelay = localStorage.getItem('auto_save_delay') || '500';
    const token = localStorage.getItem('editor_token') || '';
    const ignoredDirs = localStorage.getItem('ignored_dirs') || 'node_modules, venv, .venv, __pycache__, dist, build, target';
    const chkHidden = document.querySelector('#settingToggleHidden');
    const chkAll = document.querySelector('#settingToggleAllFiles');
    const chkWordWrap = document.querySelector('#settingToggleWordWrap');
    const txtIgnored = document.querySelector('#settingSearchIgnored');
    const btnDark = document.querySelector('#btnSettingThemeDark');
    const btnLight = document.querySelector('#btnSettingThemeLight');
    const btnCompact = document.querySelector('#btnSettingDensityCompact');
    const btnNormal = document.querySelector('#btnSettingDensityNormal');
    const btnLarge = document.querySelector('#btnSettingDensityLarge');
    const zoomRange = document.querySelector('#settingZoomRange');
    const zoomVal = document.querySelector('#settingZoomVal');
    const autoSaveSelect = document.querySelector('#settingAutoSaveSelect');
    const serverInfo = document.querySelector('#settingServerInfo');
    if (chkHidden) chkHidden.checked = showHidden;
    if (chkAll) chkAll.checked = showAll;
    if (txtIgnored) txtIgnored.value = ignoredDirs;
    if (chkWordWrap) chkWordWrap.checked = wordWrap;
    if (btnDark && btnLight) {
        btnDark.classList.toggle('active', theme === 'dark');
        btnLight.classList.toggle('active', theme === 'light');
    }
    if (btnCompact && btnNormal && btnLarge) {
        btnCompact.classList.toggle('active', density === 'compact');
        btnNormal.classList.toggle('active', density === 'normal');
        btnLarge.classList.toggle('active', density === 'large');
    }
    if (zoomRange && zoomVal) {
        zoomRange.value = zoom;
        zoomVal.textContent = zoom;
    }
    if (autoSaveSelect) autoSaveSelect.value = autoSaveDelay;
    if (serverInfo) serverInfo.textContent = `Session: ${token ? token.substring(0, 6) + '...' : 'None'}`;
}
export function countWords(markdown) {
    if (!markdown) return 0;
    let clean = markdown.replace(/```[\s\S]*?```/g, '');
    clean = clean.replace(/`[^`]+`/g, '');
    clean = clean.replace(/<[^>]+>/g, '');
    clean = clean.replace(/^\s*([-_*])\s*\1\s*\1\s*$/gm, '');
    clean = clean.replace(/^\s*#+\s+/gm, '');
    clean = clean.replace(/^\s*>\s+/gm, '');
    clean = clean.replace(/^\s*([*+-]|\d+\.)\s+/gm, '');
    clean = clean.replace(/[*_~=]+/g, '');
    const words = clean.trim().split(/\s+/).filter(w => w.length > 0);
    return words.length;
}
let wordCountTimeout = null;
export function updateWordCount(ctx) {
    if (wordCountTimeout) clearTimeout(wordCountTimeout);
    wordCountTimeout = setTimeout(() => {
        const text = ctx.editor.value;
        const count = countWords(text);
        const wordCountEl = document.querySelector('#wordCount');
        if (wordCountEl) wordCountEl.textContent = `${count} ${count === 1 ? 'word' : 'words'}`;
    }, 500);
}
export function filterBrowserItems(query) {
    const items = document.querySelectorAll('.browser-item');
    const cleanQuery = query.trim().toLowerCase();
    items.forEach(item => {
        const nameEl = item.querySelector('.browser-item-name');
        if (!nameEl) return;
        const name = nameEl.textContent.toLowerCase();
        item.style.display = name.includes(cleanQuery) ? 'flex' : 'none';
    });
}
export function setupPreviewCheckboxSync(ctx) {
    ctx.preview.addEventListener('change', (e) => {
        const target = e.target;
        if (target && target.classList.contains('interactive-todo')) {
            const lineIndex = parseInt(target.dataset.line, 10);
            const isChecked = target.checked;
            const lines = ctx.editor.value.split('\n');
            if (lineIndex >= 0 && lineIndex < lines.length) {
                const line = lines[lineIndex];
                const taskMatch = line.match(/^(\s*[-*+]\s+\[)([ xX])(\]\s+.*)$/);
                if (taskMatch) {
                    const newChar = isChecked ? 'x' : ' ';
                    lines[lineIndex] = taskMatch[1] + newChar + taskMatch[3];
                    const start = ctx.editor.selectionStart;
                    const end = ctx.editor.selectionEnd;
                    const scrollTop = ctx.editor.scrollTop;
                    ctx.editor.value = lines.join('\n');
                    updateDirtyState(ctx);
                    handleAutoSave(ctx);
                    ctx.editor.setSelectionRange(start, end);
                    ctx.editor.scrollTop = scrollTop;
                    updateLineNumbers(ctx);
                    updateWordCount(ctx);
                    if (ctx.renderMarkdown) ctx.preview.innerHTML = ctx.renderMarkdown(ctx.editor.value);
                }
            }
        }
    });
}
