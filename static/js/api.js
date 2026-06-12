import { escapeHtml } from './utils.js';
import { showDiffModal } from './ui-diff.js';
import { apiGet, apiPost } from './api-client.js';

export { loadDirectory, loadBackups, loadBackupContent, searchFiles } from './api-browser.js';

export async function loadContent(ctx, path, restorePos = false) {
    try {
        ctx.setStatus('loading', 'Loading...');
        const data = await apiGet('/api/content', { path }, { ctx });
        ctx.editor.value = data.content;
        ctx.state.originalContent = data.content;
        ctx.state.activeFilePath = path;
        ctx.state.activeFileModified = data.modified;
        if (ctx.state.openFiles && ctx.state.openFiles[path]) {
            ctx.state.openFiles[path].content = data.content;
            ctx.state.openFiles[path].originalContent = data.content;
            ctx.state.openFiles[path].isDirty = false;
            ctx.state.openFiles[path].modified = data.modified;
            if (ctx.renderTabs) {
                ctx.renderTabs();
            }
        }
        if (ctx.updateWordCount) ctx.updateWordCount();
        ctx.updateLineNumbers();
        if (restorePos && ctx.state.savedSelectionStart !== null && ctx.state.savedSelectionStart !== undefined) {
            const start = Math.min(ctx.state.savedSelectionStart, ctx.editor.value.length);
            const end = Math.min(ctx.state.savedSelectionEnd !== null ? ctx.state.savedSelectionEnd : start, ctx.editor.value.length);
            ctx.editor.setSelectionRange(start, end);
            if (ctx.state.savedScrollTop !== null && ctx.state.savedScrollTop !== undefined) {
                ctx.editor.scrollTop = ctx.state.savedScrollTop;
            }
            ctx.state.savedSelectionStart = null;
            ctx.state.savedSelectionEnd = null;
            ctx.state.savedScrollTop = null;
        }
        ctx.setStatus('saved', `Loaded \u00b7 ${ctx.formatBytes(data.size)}`);
        if (ctx.state.currentTab === 'preview' && ctx.renderMarkdown) {
            ctx.preview.innerHTML = ctx.renderMarkdown(ctx.editor.value);
        }
        ctx.toast('File loaded', 'success');
        if (ctx.checkDraft) ctx.checkDraft();
    } catch (err) {
        if (err.code !== 'auth') {
            ctx.setStatus('error', 'Load failed');
            ctx.toast(`Failed to load: ${err.message}`, 'error');
            throw err;
        }
    }
}

export async function saveContent(ctx, path) {
    if (!ctx.state.isDirty) {
        ctx.toast('No changes to save', 'info');
        return;
    }
    try {
        ctx.setStatus('saving', 'Saving...');
        let data;
        try {
            data = await apiPost('/api/content', {
                path,
                content: ctx.editor.value,
                modified: ctx.state.activeFileModified
            }, { ctx });
        } catch (fetchErr) {
            if (fetchErr.code === 'network' || fetchErr.code === 'timeout') {
                const { queueOfflineSave } = await import('./indexeddb-sync.js');
                await queueOfflineSave(path, ctx.editor.value, ctx.state.activeFileModified);
                ctx.state.originalContent = ctx.editor.value;
                ctx.state.isDirty = false;
                if (ctx.state.openFiles && ctx.state.openFiles[path]) {
                    ctx.state.openFiles[path].content = ctx.editor.value;
                    ctx.state.openFiles[path].originalContent = ctx.editor.value;
                    ctx.state.openFiles[path].isDirty = false;
                    if (ctx.renderTabs) ctx.renderTabs();
                }
                ctx.setStatus('saved', 'Saved offline');
                ctx.toast('Offline: Changes queued locally', 'warning');
                if (ctx.clearDraft) ctx.clearDraft();
                return;
            }
            if (fetchErr.code === 'conflict') {
                const serverData = await apiGet('/api/content', { path }, { ctx });
                const choice = await showDiffModal(ctx, path, ctx.editor.value, serverData.content);
                if (choice === 'local') {
                    const forceData = await apiPost('/api/content', { path, content: ctx.editor.value }, { ctx });
                    ctx.state.originalContent = ctx.editor.value;
                    ctx.state.isDirty = false;
                    ctx.state.activeFileModified = forceData.modified;
                    if (ctx.state.openFiles && ctx.state.openFiles[path]) {
                        ctx.state.openFiles[path].content = ctx.editor.value;
                        ctx.state.openFiles[path].originalContent = ctx.editor.value;
                        ctx.state.openFiles[path].isDirty = false;
                        ctx.state.openFiles[path].modified = forceData.modified;
                        if (ctx.renderTabs) ctx.renderTabs();
                    }
                    if (ctx.updateWordCount) ctx.updateWordCount();
                    ctx.setStatus('saved', `Saved \u00b7 ${ctx.formatBytes(forceData.size)}`);
                    ctx.toast('Save successful (overwritten)', 'success');
                    if (ctx.clearDraft) ctx.clearDraft();
                } else if (choice === 'server') {
                    ctx.editor.value = serverData.content;
                    ctx.state.originalContent = serverData.content;
                    ctx.state.isDirty = false;
                    ctx.state.activeFileModified = serverData.modified;
                    if (ctx.state.openFiles && ctx.state.openFiles[path]) {
                        ctx.state.openFiles[path].content = serverData.content;
                        ctx.state.openFiles[path].originalContent = serverData.content;
                        ctx.state.openFiles[path].isDirty = false;
                        ctx.state.openFiles[path].modified = serverData.modified;
                        if (ctx.renderTabs) ctx.renderTabs();
                    }
                    if (ctx.updateWordCount) ctx.updateWordCount();
                    ctx.updateLineNumbers();
                    ctx.setStatus('saved', `Loaded \u00b7 ${ctx.formatBytes(serverData.size)}`);
                    ctx.toast('Loaded server version', 'success');
                    if (ctx.clearDraft) ctx.clearDraft();
                }
                return;
            }
            throw fetchErr;
        }
        ctx.state.originalContent = ctx.editor.value;
        ctx.state.isDirty = false;
        ctx.state.activeFileModified = data.modified;
        if (ctx.state.openFiles && ctx.state.openFiles[path]) {
            ctx.state.openFiles[path].content = ctx.editor.value;
            ctx.state.openFiles[path].originalContent = ctx.editor.value;
            ctx.state.openFiles[path].isDirty = false;
            ctx.state.openFiles[path].modified = data.modified;
            if (ctx.renderTabs) {
                ctx.renderTabs();
            }
        }
        if (ctx.updateWordCount) ctx.updateWordCount();
        ctx.setStatus('saved', `Saved \u00b7 ${ctx.formatBytes(data.size)}`);
        ctx.toast('Save successful', 'success');
        if (ctx.clearDraft) ctx.clearDraft();
    } catch (err) {
        if (err.code !== 'auth') {
            ctx.setStatus('error', 'Save failed');
            ctx.toast(`Save failed: ${err.message}`, 'error');
        }
    }
}

export async function performRestore(ctx, name, path) {
    try {
        ctx.setStatus('saving', 'Restoring...');
        await apiPost('/api/restore', { name, path }, { ctx });
        await loadContent(ctx, path);
        ctx.toast(`Restored: ${name}`, 'success');
        ctx.switchTab('edit');
    } catch (err) {
        if (err.code !== 'auth') {
            ctx.setStatus('error', 'Restore failed');
            ctx.toast(`Restore failed: ${err.message}`, 'error');
        }
    }
}

export async function getSettings(ctx) {
    try {
        return await apiGet('/api/settings', {}, { ctx });
    } catch (err) {
        if (err.code !== 'auth') {
            ctx.toast(`Failed to load settings: ${err.message}`, 'error');
            const statusEl = document.querySelector('#settingServerStatus');
            if (statusEl) {
                statusEl.textContent = 'Disconnected';
                statusEl.style.color = 'var(--destructive)';
            }
        }
        return null;
    }
}

export async function saveSettings(ctx, data) {
    try {
        await apiPost('/api/settings', data, { ctx });
    } catch (err) {
        if (err.code !== 'auth') {
            ctx.toast(`Failed to sync settings: ${err.message}`, 'error');
        }
    }
}

export { createItem, deleteItem, renameItem } from './api-browser-ops.js';
