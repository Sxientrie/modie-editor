import { apiGet, apiPost, onRequestError } from './api-client.js';
import { showDiffModal } from './ui-diff.js';

const DB_NAME = 'modie_offline_db';
const STORE_NAME = 'write_queue';

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'path' });
            }
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = (e) => reject(e.target.error);
    });
}

export async function queueOfflineSave(path, content, modified) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.put({ path, content, modified, timestamp: Date.now() });
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

export async function getQueue() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export async function deleteQueueItem(path) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.delete(path);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

let isSyncing = false;

export async function syncQueue(ctx) {
    if (isSyncing) return;
    isSyncing = true;
    try {
        const queue = await getQueue();
        if (queue.length === 0) {
            isSyncing = false;
            return;
        }
        ctx.toast(`Syncing ${queue.length} offline changes...`, 'info');
        for (const item of queue) {
            try {
                let data;
                try {
                    data = await apiPost('/api/content', {
                        path: item.path,
                        content: item.content,
                        modified: item.modified
                    }, { ctx });
                } catch (err) {
                    if (err.code === 'conflict') {
                        const serverData = await apiGet('/api/content', { path: item.path }, { ctx });
                        const choice = await showDiffModal(ctx, item.path, item.content, serverData.content);
                        if (choice === 'local') {
                            const forceData = await apiPost('/api/content', { path: item.path, content: item.content }, { ctx });
                            await deleteQueueItem(item.path);
                            if (ctx.state.activeFilePath === item.path) {
                                ctx.state.originalContent = item.content;
                                ctx.state.isDirty = false;
                                ctx.state.activeFileModified = forceData.modified;
                                ctx.updateLineNumbers();
                            }
                        } else if (choice === 'server') {
                            await deleteQueueItem(item.path);
                            if (ctx.state.activeFilePath === item.path) {
                                ctx.editor.value = serverData.content;
                                ctx.state.originalContent = serverData.content;
                                ctx.state.isDirty = false;
                                ctx.state.activeFileModified = serverData.modified;
                                ctx.updateLineNumbers();
                            }
                        }
                        continue;
                    }
                    throw err;
                }
                await deleteQueueItem(item.path);
                if (ctx.state.activeFilePath === item.path) {
                    ctx.state.originalContent = item.content;
                    ctx.state.isDirty = false;
                    ctx.state.activeFileModified = data.modified;
                    ctx.setStatus('saved', `Saved \u00b7 ${ctx.formatBytes(data.size)}`);
                }
            } catch (err) {
                if (err.code !== 'auth') {
                    ctx.toast(`Failed to sync ${item.path}: ${err.message}`, 'error');
                }
                break;
            }
        }
        const remaining = await getQueue();
        if (remaining.length === 0) {
            ctx.toast('All offline changes synchronized', 'success');
        }
    } catch (e) {
        ctx.toast(`Sync failed: ${e.message}`, 'error');
    } finally {
        isSyncing = false;
    }
}

export function initOfflineSync(ctx) {
    onRequestError(async (err, path, body, opts) => {
        if (path === '/api/content' && (err.code === 'network' || err.code === 'timeout')) {
            const context = opts.ctx;
            if (context && body && body.path && body.content) {
                await queueOfflineSave(body.path, body.content, body.modified);
                context.state.originalContent = body.content;
                context.state.isDirty = false;
                if (context.state.openFiles && context.state.openFiles[body.path]) {
                    context.state.openFiles[body.path].content = body.content;
                    context.state.openFiles[body.path].originalContent = body.content;
                    context.state.openFiles[body.path].isDirty = false;
                    if (context.renderTabs) context.renderTabs();
                }
                context.setStatus('saved', 'Saved offline');
                context.toast('Offline: Changes queued locally', 'warning');
                if (context.clearDraft) context.clearDraft();
            }
        }
    });

    window.addEventListener('online', () => syncQueue(ctx));
    setInterval(() => {
        if (navigator.onLine) {
            syncQueue(ctx);
        }
    }, 30000);
}
