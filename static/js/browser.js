import { loadDirectory, loadBackupContent } from './api-browser.js';

export function setupBrowser(ctx, state) {
    const $ = (s) => document.querySelector(s);
    const btnMore = $('#btnBrowserMore'), dropdown = $('#browserMoreDropdown');
    if (btnMore && dropdown) {
        btnMore.addEventListener('click', (e) => { e.stopPropagation(); dropdown.style.display = dropdown.style.display === 'flex' ? 'none' : 'flex'; });
        document.addEventListener('click', (e) => { if (!dropdown.contains(e.target) && e.target !== btnMore && !btnMore.contains(e.target)) dropdown.style.display = 'none'; });
        dropdown.querySelectorAll('.menu-item').forEach(item => item.addEventListener('click', () => dropdown.style.display = 'none'));
    }
    $('#browserList').addEventListener('click', (e) => {
        const item = e.target.closest('.browser-item');
        if (item) {
            const path = item.dataset.path;
            const isDir = item.dataset.isDir === 'true';
            const line = item.dataset.line;
            if (isDir) {
                loadDirectory(ctx, path);
            } else {
                ctx.openFile(path).then(() => {
                    if (line) {
                        const lineNum = parseInt(line, 10);
                        const lines = ctx.editor.value.split('\n');
                        let charIndex = 0;
                        for (let i = 0; i < Math.min(lineNum - 1, lines.length); i++) charIndex += lines[i].length + 1;
                        ctx.editor.focus();
                        ctx.editor.setSelectionRange(charIndex, charIndex);
                        const lh = parseFloat(getComputedStyle(ctx.editor).lineHeight);
                        ctx.editor.scrollTop = (lineNum - 3) * lh;
                    }
                });
            }
        }
    });
    $('#backupList').addEventListener('click', (e) => {
        const btnRestore = e.target.closest('.btn-restore');
        if (btnRestore) {
            const name = btnRestore.dataset.name;
            state.pendingRestore = name;
            $('#restoreModalText').textContent = `Restore "${name}"? Current content will be backed up before the restore.`;
            $('#restoreModal').classList.add('active');
            history.pushState({ modal: 'restoreModal' }, '');
            return;
        }
        const btnPreview = e.target.closest('.btn-preview-backup');
        if (btnPreview && state.activeFilePath) {
            const name = btnPreview.dataset.name;
            loadBackupContent(ctx, name, state.activeFilePath).then((content) => {
                if (content !== null) {
                    state.currentBackupContent = content;
                    $('#previewBackupTitle').textContent = `Preview: ${name}`;
                    const contentEl = $('#previewBackupContent');
                    contentEl.className = 'markdown-body rendered-mode';
                    contentEl.innerHTML = ctx.renderMarkdown(content);
                    $('#btnToggleBackupFormat').textContent = 'Show Raw';
                    $('#btnPreviewBackupRestore').dataset.name = name;
                    $('#previewBackupModal').classList.add('active');
                    history.pushState({ modal: 'previewBackupModal' }, '');
                }
            }).catch(() => {});
        }
    });
    $('#btnToggleBackupFormat').addEventListener('click', () => {
        const contentEl = $('#previewBackupContent');
        const isRaw = contentEl.classList.toggle('raw-mode');
        if (isRaw) {
            contentEl.classList.remove('markdown-body', 'rendered-mode');
            contentEl.textContent = state.currentBackupContent;
            $('#btnToggleBackupFormat').textContent = 'Show Rendered';
        } else {
            contentEl.classList.remove('raw-mode');
            contentEl.classList.add('markdown-body', 'rendered-mode');
            contentEl.innerHTML = ctx.renderMarkdown(state.currentBackupContent);
            $('#btnToggleBackupFormat').textContent = 'Show Raw';
        }
    });
    $('#btnPreviewBackupClose').addEventListener('click', () => {
        $('#previewBackupModal').classList.remove('active');
        if (history.state && history.state.modal === 'previewBackupModal') history.back();
    });
    $('#previewBackupModal').addEventListener('click', (e) => {
        if (e.target === $('#previewBackupModal')) {
            $('#previewBackupModal').classList.remove('active');
            if (history.state && history.state.modal === 'previewBackupModal') history.back();
        }
    });
    $('#btnPreviewBackupRestore').addEventListener('click', (e) => {
        const name = e.target.dataset.name;
        $('#previewBackupModal').classList.remove('active');
        if (history.state && history.state.modal === 'previewBackupModal') history.back();
        state.pendingRestore = name;
        $('#restoreModalText').textContent = `Restore "${name}"? Current content will be backed up before the restore.`;
        $('#restoreModal').classList.add('active');
        history.pushState({ modal: 'restoreModal' }, '');
    });
    $('#btnDraftRestore').addEventListener('click', () => {
        if (state.activeFilePath) {
            const raw = localStorage.getItem(`modie_draft_${state.activeFilePath}`);
            let content = null;
            if (raw) {
                try {
                    const draft = JSON.parse(raw);
                    if (draft.path === state.activeFilePath) content = draft.content;
                } catch (e) {}
            }
            if (content !== null) {
                ctx.editor.value = content;
                import('./ui.js').then((uiMod) => {
                    uiMod.updateLineNumbers(ctx); uiMod.updateDirtyState(ctx);
                    if (ctx.updateWordCount) ctx.updateWordCount();
                });
            }
        }
        $('#draftModal').classList.remove('active');
        if (history.state && history.state.modal === 'draftModal') history.back();
    });
    $('#btnDraftDiscard').addEventListener('click', () => {
        import('./ui.js').then((uiMod) => uiMod.clearDraft(ctx));
        $('#draftModal').classList.remove('active');
        if (history.state && history.state.modal === 'draftModal') history.back();
    });
}
