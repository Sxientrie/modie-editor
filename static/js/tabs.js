import { escapeHtml } from './utils.js';
import * as api from './api.js';
import * as ui from './ui.js';
import { getOrCreateStack, removeStack } from './undo.js';
import { apiGet, apiPost } from './api-client.js';

let ctx = null;
let state = null;
let startWatching = null;
let stopWatching = null;
let switchTab = null;

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

export function initTabs(c, s, startW, stopW, switchTabFn) {
    ctx = c;
    state = s;
    startWatching = startW;
    stopWatching = stopW;
    switchTab = switchTabFn;
    ctx.subscribe((prop) => {
        if (prop === 'activeFilePath') renderTabs();
    });
}

export function renderTabs() {
    const container = $('#fileTabs');
    if (!container) return;
    const paths = Object.keys(state.openFiles);
    if (paths.length === 0) {
        container.style.display = 'none';
        return;
    }
    container.style.display = 'flex';
    
    const tabsHtml = paths.map(path => {
        const name = path.split('/').pop();
        const isActive = path === state.activeFilePath;
        const isDirty = state.openFiles[path].isDirty;
        const dirtyIndicator = isDirty ? '<span style="color:var(--primary); font-size: 8px; margin-left: 2px;">●</span>' : '';
        return `
            <div class="file-tab${isActive ? ' active' : ''}" data-path="${escapeHtml(path)}">
                <span>${escapeHtml(name)} ${dirtyIndicator}</span>
                <span class="file-tab-close" data-path="${escapeHtml(path)}"><i data-lucide="x" style="width: 10px; height: 10px;"></i></span>
            </div>
        `;
    }).join('');

    const newTabHtml = `
        <div class="file-tab-new" id="btnNewTab" title="New Tab">
            <i data-lucide="plus" style="width: 12px; height: 12px;"></i>
        </div>
    `;

    container.innerHTML = tabsHtml + newTabHtml;
    window.lucide.createIcons({ nodes: [container] });
    
    container.querySelectorAll('.file-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            if (e.target.closest('.file-tab-close')) return;
            const targetPath = tab.dataset.path;
            switchToFile(targetPath);
        });
    });
    container.querySelectorAll('.file-tab-close').forEach(closeBtn => {
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const targetPath = closeBtn.dataset.path;
            closeTab(targetPath);
        });
    });

    const newTabBtn = $('#btnNewTab');
    if (newTabBtn) {
        newTabBtn.addEventListener('click', async () => {
            const name = await ctx.showPrompt('New File', 'Enter file name:');
            if (name) {
                try {
                    await apiPost('/api/create', { path: state.currentPath, name, is_dir: false }, { ctx });
                    const filePath = state.currentPath ? `${state.currentPath}/${name}` : name;
                    await openFile(filePath);
                } catch (err) {
                    ctx.toast(err.message || 'Failed to create file', 'error');
                }
            }
        });
    }
}

export function saveCurrentTabState() {
    const activePath = state.activeFilePath;
    if (activePath && state.openFiles[activePath]) {
        state.openFiles[activePath] = {
            path: activePath,
            content: ctx.editor.value,
            originalContent: state.originalContent,
            isDirty: state.isDirty,
            selectionStart: ctx.editor.selectionStart,
            selectionEnd: ctx.editor.selectionEnd,
            scrollTop: ctx.editor.scrollTop,
            modified: state.activeFileModified
        };
    }
}

export function saveWorkspaceState() {
    saveCurrentTabState();
    const workspace = {
        activeFilePath: state.activeFilePath,
        currentPath: state.currentPath,
        openFiles: Object.keys(state.openFiles).map(path => {
            const f = state.openFiles[path];
            return {
                path: f.path,
                selectionStart: f.selectionStart,
                selectionEnd: f.selectionEnd,
                scrollTop: f.scrollTop
            };
        })
    };
    localStorage.setItem('modie_workspace_state', JSON.stringify(workspace));
}

export function switchToFile(path) {
    if (path === state.activeFilePath) return;
    saveCurrentTabState();
    
    const targetState = state.openFiles[path];
    if (targetState) {
        state.activeFilePath = path;
        ctx.editor.value = targetState.content;
        state.originalContent = targetState.originalContent;
        state.isDirty = targetState.isDirty;
        state.activeFileModified = targetState.modified;
        
        ctx.editor.setSelectionRange(targetState.selectionStart || 0, targetState.selectionEnd || 0);
        ctx.editor.scrollTop = targetState.scrollTop || 0;
        
        ui.updateLineNumbers(ctx);
        ui.updateDirtyState(ctx);
        if (ctx.updateWordCount) ctx.updateWordCount();
        
        $('#headerTitle').textContent = 'MODiE';
        $('#headerSubtitle').textContent = 'Editor';
        
        $('.tab-bar').style.display = 'flex';
        $('#fileTabs').style.display = 'flex';
        $('#btnBack').style.display = 'inline-flex';
        $('#logoIcon').style.display = 'none';
        $('#btnFind').style.display = 'inline-flex';
        $('#btnOutline').style.display = 'inline-flex';
        $('#btnSave').style.display = 'inline-flex';

        if (state.currentTab === 'browser') {
            switchTab('edit');
        } else {
            const toolbar = $('#formatToolbar');
            if (toolbar) toolbar.style.display = state.currentTab === 'edit' ? 'flex' : 'none';
        }
        
        startWatching(path);
        renderTabs();
        saveWorkspaceState();
    }
}

export async function closeTab(path, forceSilent = false) {
    const tabState = state.openFiles[path];
    if (tabState && tabState.isDirty && !forceSilent) {
        const discard = await ctx.showConfirm('Unsaved Changes', `Discard unsaved changes for "${path.split('/').pop()}"?`);
        if (!discard) return;
    }
    
    if (path === state.activeFilePath) {
        stopWatching();
    }
    
    delete state.openFiles[path];
    localStorage.removeItem(`modie_draft_${path}`);
    removeStack(path);
    
    const remainingPaths = Object.keys(state.openFiles);
    if (remainingPaths.length > 0) {
        if (path === state.activeFilePath) {
            switchToFile(remainingPaths[remainingPaths.length - 1]);
        } else {
            renderTabs();
            saveWorkspaceState();
        }
    } else {
        state.activeFilePath = null;
        state.activeFileModified = null;
        state.isDirty = false;
        ctx.editor.value = '';
        state.originalContent = '';
        ctx.preview.innerHTML = '';
        
        $('.tab-bar').style.display = 'none';
        $('#fileTabs').style.display = 'none';
        $('#formatToolbar').style.display = 'none';
        $('#btnBack').style.display = 'none';
        $('#logoIcon').style.display = 'flex';
        $('#btnFind').style.display = 'none';
        $('#btnOutline').style.display = 'none';
        $('#btnSave').style.display = 'none';
        $('#headerTitle').textContent = 'MODiE';
        $('#headerSubtitle').textContent = 'Browser';
        
        const findBar = $('#findBar');
        if (findBar && findBar.classList.contains('active')) {
            ui.toggleFind(ctx);
        }
        const outline = $('#outlineDrawer');
        if (outline && outline.classList.contains('active')) {
            ui.toggleOutline(ctx);
        }
        
        stopWatching();
        switchTab('browser');
        api.loadDirectory(ctx, state.currentPath);
        localStorage.removeItem('modie_workspace_state');
    }
}

export function openFile(path) {
    if (state.openFiles[path]) {
        switchToFile(path);
        return Promise.resolve();
    }
    return api.loadContent(ctx, path).then(() => {
        $('.tab-bar').style.display = 'flex';
        $('#fileTabs').style.display = 'flex';
        $('#btnBack').style.display = 'inline-flex';
        $('#logoIcon').style.display = 'none';
        $('#btnFind').style.display = 'inline-flex';
        $('#btnOutline').style.display = 'inline-flex';
        $('#btnSave').style.display = 'inline-flex';
        $('#headerTitle').textContent = 'MODiE';
        $('#headerSubtitle').textContent = 'Editor';
        
        state.openFiles[path] = {
            path: path,
            content: ctx.editor.value,
            originalContent: state.originalContent,
            isDirty: false,
            selectionStart: 0,
            selectionEnd: 0,
            scrollTop: 0,
            modified: state.activeFileModified
        };
        getOrCreateStack(path, ctx.editor.value);
        
        switchTab('edit');
        startWatching(path);
        renderTabs();
        saveWorkspaceState();
    }).catch(() => {});
}

export async function closeFile(shouldLoadDir = true) {
    const paths = Object.keys(state.openFiles);
    for (const p of paths) {
        await closeTab(p, true);
    }
}

export async function restoreWorkspace(workspace) {
    const paths = workspace.openFiles.map(f => f.path);
    if (paths.length === 0) return false;
    
    let activeFileFound = false;
    const loadPromises = workspace.openFiles.map(async (fileInfo) => {
        try {
            const data = await apiGet('/api/content', { path: fileInfo.path }, { ctx });
            return { fileInfo, data, success: true };
        } catch (err) {
            console.error(`Failed to restore file ${fileInfo.path}`, err);
            return { fileInfo, success: false };
        }
    });
    
    const results = await Promise.all(loadPromises);
    
    for (const res of results) {
        if (res.success) {
            const { fileInfo, data } = res;
            state.openFiles[fileInfo.path] = {
                path: fileInfo.path,
                content: data.content,
                originalContent: data.content,
                isDirty: false,
                selectionStart: fileInfo.selectionStart || 0,
                selectionEnd: fileInfo.selectionEnd || 0,
                scrollTop: fileInfo.scrollTop || 0,
                modified: data.modified
            };
            getOrCreateStack(fileInfo.path, data.content);
            if (fileInfo.path === workspace.activeFilePath) {
                activeFileFound = true;
            }
        }
    }
    
    const remainingPaths = Object.keys(state.openFiles);
    if (remainingPaths.length > 0) {
        if (workspace.activeFilePath !== null && activeFileFound) {
            const activePath = workspace.activeFilePath;
            const targetState = state.openFiles[activePath];
            state.activeFilePath = activePath;
            ctx.editor.value = targetState.content;
            state.originalContent = targetState.originalContent;
            state.isDirty = false;
            state.activeFileModified = targetState.modified;
            
            ctx.editor.setSelectionRange(targetState.selectionStart || 0, targetState.selectionEnd || 0);
            ctx.editor.scrollTop = targetState.scrollTop || 0;
            
            ui.updateLineNumbers(ctx);
            ui.updateDirtyState(ctx);
            if (ctx.updateWordCount) ctx.updateWordCount();
            
            $('#headerTitle').textContent = 'MODiE';
            $('#headerSubtitle').textContent = 'Editor';
            
            $('.tab-bar').style.display = 'flex';
            $('#fileTabs').style.display = 'flex';
            $('#btnBack').style.display = 'inline-flex';
            $('#logoIcon').style.display = 'none';
            $('#btnFind').style.display = 'inline-flex';
            $('#btnOutline').style.display = 'inline-flex';
            $('#btnSave').style.display = 'inline-flex';

            ui.checkDraft(ctx);
            
            startWatching(activePath);
            renderTabs();
            switchTab('edit');
        } else {
            state.activeFilePath = null;
            state.activeFileModified = null;
            state.isDirty = false;
            ctx.editor.value = '';
            state.originalContent = '';
            ctx.preview.innerHTML = '';
            
            $('.tab-bar').style.display = 'none';
            $('#fileTabs').style.display = 'flex';
            $('#btnBack').style.display = 'none';
            $('#logoIcon').style.display = 'flex';
            $('#btnFind').style.display = 'none';
            $('#btnOutline').style.display = 'none';
            $('#btnSave').style.display = 'none';
            
            $('#headerTitle').textContent = 'MODiE';
            $('#headerSubtitle').textContent = 'Browser';
            
            renderTabs();
            switchTab('browser');
        }
        
        const parentPath = workspace.currentPath !== undefined ? workspace.currentPath : (workspace.activeFilePath ? workspace.activeFilePath.substring(0, workspace.activeFilePath.lastIndexOf('/')) : '');
        api.loadDirectory(ctx, parentPath);
        return true;
    }
    return false;
}
