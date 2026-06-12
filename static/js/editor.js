import { saveWorkspaceState } from './tabs.js';
import { pushState, undo, redo } from './undo.js';

function debounce(fn, delay) {
    let timeout = null;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn.apply(this, args), delay);
    };
}

export function setupEditor(ctx, state, ui, api) {
    const saveWorkspaceStateDebounced = debounce(saveWorkspaceState, 250);
    const populateOutlineDebounced = debounce(() => {
        const drawer = document.querySelector('#outlineDrawer');
        if (drawer && drawer.classList.contains('active')) {
            ui.populateOutline(ctx);
        }
    }, 500);
    const renderPreviewDebounced = debounce(() => {
        if (window.innerWidth >= 768 && state.activeFilePath) {
            ctx.preview.innerHTML = ctx.renderMarkdown(ctx.editor.value);
        }
    }, 500);
    const pushStateDebounced = debounce(() => {
        if (state.activeFilePath && state.openFiles[state.activeFilePath]) {
            pushState(state.activeFilePath, ctx.editor.value, ctx.editor.selectionStart, ctx.editor.selectionEnd);
        }
    }, 300);

    ctx.editor.addEventListener('input', () => {
        ui.updateLineNumbers(ctx);
        ui.updateDirtyState(ctx);
        ui.handleAutoSave(ctx);
        ui.updateWordCount(ctx);
        populateOutlineDebounced();
        if (state.activeFilePath && state.openFiles[state.activeFilePath]) {
            state.openFiles[state.activeFilePath].content = ctx.editor.value;
            pushStateDebounced();
            saveWorkspaceStateDebounced();
        }
        renderPreviewDebounced();
    });

    ctx.editor.addEventListener('scroll', () => {
        ui.syncScroll(ctx);
        if (state.activeFilePath && state.openFiles[state.activeFilePath]) {
            state.openFiles[state.activeFilePath].scrollTop = ctx.editor.scrollTop;
            saveWorkspaceStateDebounced();
        }
    });
    ctx.editor.addEventListener('click', () => {
        ui.updateCursorPos(ctx);
        if (state.activeFilePath && state.openFiles[state.activeFilePath]) {
            state.openFiles[state.activeFilePath].selectionStart = ctx.editor.selectionStart;
            state.openFiles[state.activeFilePath].selectionEnd = ctx.editor.selectionEnd;
            saveWorkspaceStateDebounced();
        }
    });
    ctx.editor.addEventListener('keyup', () => {
        ui.updateCursorPos(ctx);
        if (state.activeFilePath && state.openFiles[state.activeFilePath]) {
            state.openFiles[state.activeFilePath].selectionStart = ctx.editor.selectionStart;
            state.openFiles[state.activeFilePath].selectionEnd = ctx.editor.selectionEnd;
            saveWorkspaceStateDebounced();
        }
    });

    ctx.editor.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
            e.preventDefault();
            const start = ctx.editor.selectionStart;
            const end = ctx.editor.selectionEnd;
            const value = ctx.editor.value;
            const selectedText = value.substring(start, end);
            ctx.editor.focus();
            if (selectedText.includes('\n')) {
                const before = value.substring(0, start);
                const lineStartPos = before.lastIndexOf('\n') + 1;
                const targetText = value.substring(lineStartPos, end);
                const lines = targetText.split('\n');
                const indentedLines = lines.map(line => '    ' + line);
                const newText = indentedLines.join('\n');
                ctx.editor.setSelectionRange(lineStartPos, end);
                document.execCommand('insertText', false, newText);
                ctx.editor.setSelectionRange(lineStartPos, lineStartPos + newText.length);
            } else {
                ctx.editor.setSelectionRange(start, end);
                document.execCommand('insertText', false, '    ');
            }
            ui.updateLineNumbers(ctx);
            ui.updateDirtyState(ctx);
        } else if (e.key === 'Enter') {
            const textarea = ctx.editor;
            const val = textarea.value;
            const start = textarea.selectionStart;
            const before = val.substring(0, start);
            const lastLine = before.substring(before.lastIndexOf('\n') + 1);
            const taskMatch = lastLine.match(/^(\s*[-*+]\s+\[[ xX]\]\s+)(.*)$/);
            const ulMatch = lastLine.match(/^(\s*[-*+]\s+)(.*)$/);
            const olMatch = lastLine.match(/^(\s*)(\d+)\.\s+(.*)$/);

            if (taskMatch) {
                const marker = taskMatch[1];
                const content = taskMatch[2];
                textarea.focus();
                if (!content.trim()) {
                    e.preventDefault();
                    const lineStart = before.lastIndexOf('\n') + 1;
                    textarea.setSelectionRange(lineStart, start);
                    document.execCommand('insertText', false, '\n');
                } else {
                    e.preventDefault();
                    const cleanMarker = marker.replace(/\[[xX]\]/, '[ ]');
                    textarea.setSelectionRange(start, start);
                    document.execCommand('insertText', false, '\n' + cleanMarker);
                }
                ui.updateLineNumbers(ctx);
                ui.updateDirtyState(ctx);
            } else if (ulMatch) {
                const marker = ulMatch[1];
                const content = ulMatch[2];
                textarea.focus();
                if (!content.trim()) {
                    e.preventDefault();
                    const lineStart = before.lastIndexOf('\n') + 1;
                    textarea.setSelectionRange(lineStart, start);
                    document.execCommand('insertText', false, '\n');
                } else {
                    e.preventDefault();
                    textarea.setSelectionRange(start, start);
                    document.execCommand('insertText', false, '\n' + marker);
                }
                ui.updateLineNumbers(ctx);
                ui.updateDirtyState(ctx);
            } else if (olMatch) {
                const indent = olMatch[1];
                const num = parseInt(olMatch[2], 10);
                const content = olMatch[3];
                textarea.focus();
                if (!content.trim()) {
                    e.preventDefault();
                    const lineStart = before.lastIndexOf('\n') + 1;
                    textarea.setSelectionRange(lineStart, start);
                    document.execCommand('insertText', false, '\n');
                } else {
                    e.preventDefault();
                    const nextMarker = `${indent}${num + 1}. `;
                    textarea.setSelectionRange(start, start);
                    document.execCommand('insertText', false, '\n' + nextMarker);
                }
                ui.updateLineNumbers(ctx);
                ui.updateDirtyState(ctx);
            }
        }
    });

    const $ = (s) => document.querySelector(s);
    const $$ = (s) => document.querySelectorAll(s);

    $('#btnSave').addEventListener('click', () => { if (state.activeFilePath) api.saveContent(ctx, state.activeFilePath); });

    const btnToolbarSave = $('#btnToolbarSave');
    if (btnToolbarSave) {
        btnToolbarSave.addEventListener('click', (e) => {
            e.preventDefault();
            if (state.activeFilePath) api.saveContent(ctx, state.activeFilePath);
        });
    }

    $$('.fmt-btn').forEach(btn => btn.addEventListener('click', (e) => {
        e.preventDefault();
        if (btn.id === 'btnUndo' || btn.id === 'btnRedo') return;
        import('./ui-find.js').then((findMod) => {
            findMod.handleFormat(ctx, btn);
        });
    }));

    $('#btnUndo').addEventListener('click', (e) => {
        e.preventDefault();
        if (state.activeFilePath) {
            const entry = undo(state.activeFilePath);
            if (entry) {
                ctx.editor.value = entry.content;
                ctx.editor.setSelectionRange(entry.selectionStart, entry.selectionEnd);
                ui.updateLineNumbers(ctx);
                ui.updateDirtyState(ctx);
                ui.updateWordCount(ctx);
                if (state.openFiles[state.activeFilePath]) {
                    state.openFiles[state.activeFilePath].content = entry.content;
                }
                saveWorkspaceStateDebounced();
            }
        }
    });

    $('#btnRedo').addEventListener('click', (e) => {
        e.preventDefault();
        if (state.activeFilePath) {
            const entry = redo(state.activeFilePath);
            if (entry) {
                ctx.editor.value = entry.content;
                ctx.editor.setSelectionRange(entry.selectionStart, entry.selectionEnd);
                ui.updateLineNumbers(ctx);
                ui.updateDirtyState(ctx);
                ui.updateWordCount(ctx);
                if (state.openFiles[state.activeFilePath]) {
                    state.openFiles[state.activeFilePath].content = entry.content;
                }
                saveWorkspaceStateDebounced();
            }
        }
    });

    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            if (state.activeFilePath) api.saveContent(ctx, state.activeFilePath);
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
            e.preventDefault();
            ui.toggleFind(ctx);
        }
        if (e.key === 'Escape') {
            const outline = $('#outlineDrawer');
            if (outline && outline.classList.contains('active')) {
                ui.toggleOutline(ctx);
            }
            const findBar = $('#findBar');
            if (findBar && findBar.classList.contains('active')) {
                ui.toggleFind(ctx);
            }
        }
    });

    if (window.visualViewport) {
        const resizeHandler = () => {
            const app = $('#app');
            if (app) {
                app.style.position = 'absolute';
                app.style.top = `${window.visualViewport.offsetTop}px`;
                app.style.left = `${window.visualViewport.offsetLeft}px`;
                app.style.width = `${window.visualViewport.width}px`;
                app.style.height = `${window.visualViewport.height}px`;
                window.scrollTo(0, 0);
            }
        };
        window.visualViewport.addEventListener('resize', resizeHandler);
        window.visualViewport.addEventListener('scroll', resizeHandler);
        window.addEventListener('scroll', () => window.scrollTo(0, 0));
        resizeHandler();
    }
}
