import * as api from './api.js';
import { apiGet } from './api-client.js';

let watchSource = null;
let ctx = null;
let state = null;
let reconnectTimeout = null;

const $ = (s) => document.querySelector(s);

export function initWatch(c, s) {
    ctx = c;
    state = s;
}

export function stopWatching() {
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }
    if (watchSource) {
        watchSource.close();
        watchSource = null;
    }
}

export function startWatching(path) {
    stopWatching();
    const token = localStorage.getItem('editor_token');
    if (!token) return;
    watchSource = new EventSource(`/api/watch?path=${encodeURIComponent(path)}&token=${encodeURIComponent(token)}`);
    watchSource.onmessage = async (e) => {
        try {
            const data = JSON.parse(e.data);
            if (data.changed && data.modified && data.modified !== state.activeFileModified) {
                stopWatching();
                if (!state.isDirty) {
                    state.savedSelectionStart = ctx.editor.selectionStart;
                    state.savedSelectionEnd = ctx.editor.selectionEnd;
                    state.savedScrollTop = ctx.editor.scrollTop;
                    api.loadContent(ctx, path, true).then(() => {
                        startWatching(path);
                    });
                } else {
                    try {
                        const incomingData = await apiGet('/api/content', { path }, { ctx });
                        const incomingContent = incomingData.content;
                        const currentContent = ctx.editor.value;
                        const currentLines = currentContent.split('\n');
                        const incomingLines = incomingContent.split('\n');
                        const diff = incomingLines.length - currentLines.length;
                        const diffText = diff >= 0 ? `+${diff} lines` : `${diff} lines`;
                        $('#externalChangeDiffText').textContent = `The file on disk has changed. Incoming: ${incomingLines.length} lines, Current: ${currentLines.length} lines (${diffText}).`;
                        const N = 100;
                        const currentTruncated = currentLines.slice(0, N).join('\n') + (currentLines.length > N ? '\n...' : '');
                        const incomingTruncated = incomingLines.slice(0, N).join('\n') + (incomingLines.length > N ? '\n...' : '');
                        $('#externalChangeCurrent').textContent = currentTruncated;
                        $('#externalChangeIncoming').textContent = incomingTruncated;
                        const modal = $('#externalChangeModal');
                        modal.classList.add('active');
                        history.pushState({ modal: 'externalChangeModal' }, '');
                        function cleanup() {
                            modal.classList.remove('active');
                            $('#btnExternalChangeKeep').removeEventListener('click', onKeep);
                            $('#btnExternalChangeAccept').removeEventListener('click', onAccept);
                            if (history.state && history.state.modal === 'externalChangeModal') history.back();
                        }
                        function onKeep() {
                            cleanup();
                            state.activeFileModified = incomingData.modified;
                            startWatching(path);
                        }
                        function onAccept() {
                            cleanup();
                            state.savedSelectionStart = ctx.editor.selectionStart;
                            state.savedSelectionEnd = ctx.editor.selectionEnd;
                            state.savedScrollTop = ctx.editor.scrollTop;
                            api.loadContent(ctx, path, true).then(() => {
                                startWatching(path);
                            });
                        }
                        $('#btnExternalChangeKeep').addEventListener('click', onKeep);
                        $('#btnExternalChangeAccept').addEventListener('click', onAccept);
                    } catch (err) {
                        const reload = await ctx.showConfirm('File Changed', 'File changed externally. Reload?');
                        if (reload) {
                            state.savedSelectionStart = ctx.editor.selectionStart;
                            state.savedSelectionEnd = ctx.editor.selectionEnd;
                            state.savedScrollTop = ctx.editor.scrollTop;
                            api.loadContent(ctx, path, true).then(() => {
                                startWatching(path);
                            });
                        } else {
                            startWatching(path);
                        }
                    }
                }
            }
        } catch (err) {
        }
    };
    watchSource.onerror = () => {
        if (watchSource) {
            watchSource.close();
            watchSource = null;
            if (state.activeFilePath === path) {
                if (reconnectTimeout) clearTimeout(reconnectTimeout);
                reconnectTimeout = setTimeout(() => startWatching(path), 3000);
            }
        }
    };
}
