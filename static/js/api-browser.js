import { escapeHtml } from './utils.js';
import { apiGet } from './api-client.js';

export async function loadDirectory(ctx, path = '', append = false, offset = 0) {
    const list = document.querySelector('#browserList');
    if (!list) return;
    try {
        ctx.setStatus('loading', 'Loading files...');
        if (!append) {
            const filterInput = document.querySelector('#browserFilterInput');
            if (filterInput) filterInput.value = '';
            const filterBar = document.querySelector('#browserFilterBar');
            if (filterBar) filterBar.classList.remove('active');
            const toggleBtn = document.querySelector('#btnBrowserFilterToggle');
            if (toggleBtn) toggleBtn.classList.remove('active');
        }
        const showHidden = localStorage.getItem('show_hidden') === 'true';
        const showAll = localStorage.getItem('show_all') === 'true';
        const limit = 100;
        const data = await apiGet('/api/browser', { path, show_hidden: showHidden, show_all: showAll, limit, offset }, { ctx });
        ctx.state.currentPath = data.currentPath;
        
        if (!append) {
            const breadcrumbsEl = document.querySelector('#browserBreadcrumbs');
            if (breadcrumbsEl) {
                const parts = data.currentPath ? data.currentPath.split('/') : [];
                let currentAccumulated = '';
                const isHomeActive = parts.length === 0;
                let html = `<span class="breadcrumb-item${isHomeActive ? ' active' : ''}" data-path="">Home</span>`;
                parts.forEach((p, idx) => {
                    currentAccumulated += (idx === 0 ? '' : '/') + p;
                    let displayName = p;
                    if (p === 'termux_home') displayName = 'Termux Home';
                    else if (p === 'storage_shared') displayName = 'Shared Storage';
                    const isLast = idx === parts.length - 1;
                    if (isLast) {
                        html += ` <span class="breadcrumb-sep">/</span> <span class="breadcrumb-item active" data-path="${escapeHtml(currentAccumulated)}">${escapeHtml(displayName)}</span>`;
                    } else {
                        html += ` <span class="breadcrumb-sep">/</span> <span class="breadcrumb-item" data-path="${escapeHtml(currentAccumulated)}">${escapeHtml(displayName)}</span>`;
                    }
                });
                breadcrumbsEl.innerHTML = html;
            }
        }

        if (!append && data.items.length === 0) {
            list.innerHTML = `
                <div class="empty-state">
                    <i data-lucide="folder-open"></i>
                    <p>No files or folders found</p>
                </div>`;
            window.lucide.createIcons({ nodes: [list] });
            ctx.setStatus('saved', 'Empty directory');
            return;
        }

        const oldLoadMore = list.querySelector('.browser-load-more');
        if (oldLoadMore) oldLoadMore.remove();

        const itemsHtml = data.items.map(item => {
            const iconType = item.isDir ? 'folder' : 'file';
            const iconName = item.isDir ? 'folder' : 'file-text';
            const meta = item.isDir ? `Folder \u00b7 ${new Date(item.modified).toLocaleString()}` : `${ctx.formatBytes(item.size)} \u00b7 ${new Date(item.modified).toLocaleString()}`;
            return `
                <div class="browser-item" data-path="${escapeHtml(item.path)}" data-is-dir="${item.isDir}">
                    <div class="browser-item-icon" data-type="${iconType}"><i data-lucide="${iconName}"></i></div>
                    <div class="browser-item-info">
                        <span class="browser-item-name">${escapeHtml(item.name)}</span>
                        <span class="browser-item-meta">${meta}</span>
                    </div>
                </div>
            `;
        }).join('');

        if (append) {
            list.insertAdjacentHTML('beforeend', itemsHtml);
        } else {
            list.innerHTML = itemsHtml;
        }

        const currentTotalLoaded = offset + data.items.length;
        if (data.total_count && data.total_count > currentTotalLoaded) {
            const nextOffset = currentTotalLoaded;
            const loadMoreHtml = `
                <div class="browser-load-more" style="padding: 12px; display: flex; justify-content: center; width: 100%;">
                    <button class="btn btn-sm btn-ghost" id="btnBrowserLoadMore" data-path="${escapeHtml(data.currentPath)}" data-offset="${nextOffset}">Load More (${data.total_count - currentTotalLoaded} remaining)</button>
                </div>`;
            list.insertAdjacentHTML('beforeend', loadMoreHtml);
            
            const btnLoadMore = list.querySelector('#btnBrowserLoadMore');
            if (btnLoadMore) {
                btnLoadMore.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const pathVal = btnLoadMore.dataset.path;
                    const offsetVal = parseInt(btnLoadMore.dataset.offset, 10);
                    loadDirectory(ctx, pathVal, true, offsetVal);
                });
            }
        }

        window.lucide.createIcons({ nodes: [list] });
        ctx.setStatus('saved', `Files loaded (${currentTotalLoaded}/${data.total_count || currentTotalLoaded})`);
    } catch (err) {
        if (!append) {
            list.innerHTML = `<div class="empty-state"><p style="color:var(--destructive)">Failed to load files: ${escapeHtml(err.message)}</p></div>`;
        } else {
            ctx.toast(`Failed to load more files: ${err.message}`, 'error');
        }
        ctx.setStatus('error', 'Directory load failed');
    }
}

export async function loadBackups(ctx, path) {
    const list = document.querySelector('#backupList');
    try {
        const data = await apiGet('/api/backups', { path }, { ctx });
        let statsHtml = '';
        if (data.total_count !== undefined) {
            statsHtml = `<div class="backup-stats-summary" style="padding: 8px 12px; margin-bottom: 8px; font-size: 12px; background: var(--bg-muted); border-radius: var(--radius-sm); border: 1px solid var(--border); color: var(--text-secondary);">
                Total: ${data.total_count} backups (${ctx.formatBytes(data.total_size)})
            </div>`;
        }
        if (data.backups.length === 0) {
            list.innerHTML = statsHtml + `
                <div class="empty-state">
                    <i data-lucide="folder-open"></i>
                    <p>No backups yet</p>
                    <p class="hint">Backups are created automatically on each save</p>
                </div>`;
            window.lucide.createIcons({ nodes: [list] });
            return;
        }
        list.innerHTML = statsHtml + data.backups.map(b => `
            <div class="backup-item">
                <div class="backup-info">
                    <span class="backup-name">${escapeHtml(b.name)}</span>
                    <span class="backup-meta">${ctx.formatBytes(b.size)} \u00b7 ${new Date(b.modified).toLocaleString()}</span>
                </div>
                <div class="backup-actions" style="display: flex; gap: 4px;">
                    <button class="btn btn-sm btn-ghost btn-preview-backup" data-name="${escapeHtml(b.name)}">Preview</button>
                    <button class="btn btn-sm btn-ghost btn-restore" data-name="${escapeHtml(b.name)}">Restore</button>
                </div>
            </div>
        `).join('');
    } catch (err) {
        if (err.code !== 'auth') {
            list.innerHTML = `<div class="empty-state"><p style="color:var(--destructive)">Failed to load backups: ${escapeHtml(err.message)}</p></div>`;
            ctx.setStatus('error', 'Backup load failed');
            ctx.toast(`Failed to load backups: ${err.message}`, 'error');
        }
    }
}

export async function loadBackupContent(ctx, name, path) {
    try {
        ctx.setStatus('loading', 'Loading backup...');
        const data = await apiGet('/api/backup-content', { name, path }, { ctx });
        ctx.setStatus('saved', 'Backup loaded');
        return data.content;
    } catch (err) {
        if (err.code !== 'auth') {
            ctx.setStatus('error', 'Backup load failed');
            ctx.toast(`Failed to load backup: ${err.message}`, 'error');
            throw err;
        }
        return null;
    }
}

export async function searchFiles(ctx, query, path, caseSensitive, isRegex) {
    try {
        ctx.setStatus('loading', 'Searching...');
        const showHidden = localStorage.getItem('show_hidden') === 'true';
        const showAll = localStorage.getItem('show_all') === 'true';
        const data = await apiGet('/api/search', { query, path, case_sensitive: caseSensitive, regex: isRegex, show_hidden: showHidden, show_all: showAll }, { ctx });
        
        const list = document.querySelector('#browserList');
        if (!list) return;
        
        const countEl = document.querySelector('#globalSearchCount');
        if (countEl) {
            countEl.textContent = `${data.results.length} results`;
        }
        
        if (data.results.length === 0) {
            list.innerHTML = `
                <div class="empty-state">
                    <i data-lucide="search-code"></i>
                    <p>No matches found</p>
                </div>`;
            window.lucide.createIcons({ nodes: [list] });
            ctx.setStatus('saved', 'No matches');
            return;
        }
        
        list.innerHTML = data.results.map(res => {
            return `
                <div class="browser-item search-result-item" data-path="${escapeHtml(res.path)}" data-line="${res.line}">
                    <div class="browser-item-icon" data-type="file"><i data-lucide="file-search"></i></div>
                    <div class="browser-item-info" style="min-width: 0; flex: 1;">
                        <span class="browser-item-name" style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
                            <span>${escapeHtml(res.filename)}</span>
                            <span style="color:var(--text-muted); font-size: 10px; font-weight: normal; background: var(--bg-muted); padding: 1px 4px; border-radius: var(--radius-sm);">Line ${res.line}</span>
                        </span>
                        <span class="browser-item-meta" style="font-family:var(--font-mono); font-size: 10.5px; color:var(--text-secondary); background:var(--bg-muted); padding: 2px 6px; border-radius: var(--radius-sm); border: 1px solid var(--border); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; display: block; margin-top: 4px;">${escapeHtml(res.text)}</span>
                    </div>
                </div>
            `;
        }).join('');
        window.lucide.createIcons({ nodes: [list] });
        ctx.setStatus('saved', 'Search complete');
    } catch (err) {
        if (err.code !== 'auth') {
            ctx.setStatus('error', 'Search failed');
            ctx.toast(`Search failed: ${err.message}`, 'error');
        }
    }
}

