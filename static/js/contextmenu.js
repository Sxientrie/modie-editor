export function setupContextMenu(ctx, state, api, ui) {
    let touchTimer = null;
    let touchMoved = false;
    let touchStartX = 0;
    let touchStartY = 0;
    let activeItemElement = null;
    let ignoreNextClick = false;

    function $(s) { return document.querySelector(s); }

    function triggerContextMenu(item) {
        ignoreNextClick = true;
        state.contextItem = {
            path: item.dataset.path,
            isDir: item.dataset.isDir === 'true',
            name: item.querySelector('.browser-item-name').textContent
        };
        const titleEl = $('#contextMenuTitle');
        if (titleEl) titleEl.textContent = state.contextItem.name;
        const modalEl = $('#contextMenuModal');
        if (modalEl) {
            modalEl.classList.add('active');
            history.pushState({ modal: 'contextMenuModal' }, '');
        }
        if (modalEl) window.lucide.createIcons({ nodes: [modalEl] });
    }

    const browserListEl = $('#browserList');
    if (browserListEl) {
        browserListEl.addEventListener('touchstart', (e) => {
            const item = e.target.closest('.browser-item');
            if (!item) return;
            touchMoved = false;
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            activeItemElement = item;
            if (touchTimer) clearTimeout(touchTimer);
            touchTimer = setTimeout(() => {
                if (!touchMoved) {
                    triggerContextMenu(item);
                }
            }, 600);
        }, { passive: true });

        browserListEl.addEventListener('touchmove', (e) => {
            if (!activeItemElement) return;
            const dx = e.touches[0].clientX - touchStartX;
            const dy = e.touches[0].clientY - touchStartY;
            if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
                touchMoved = true;
                if (touchTimer) {
                    clearTimeout(touchTimer);
                    touchTimer = null;
                }
            }
        }, { passive: true });

        browserListEl.addEventListener('touchend', (e) => {
            if (touchTimer) {
                clearTimeout(touchTimer);
                touchTimer = null;
            }
            if (activeItemElement && touchMoved) {
                const dx = e.changedTouches[0].clientX - touchStartX;
                const dy = e.changedTouches[0].clientY - touchStartY;
                if (dx < -60 && Math.abs(dy) < 30) {
                    triggerContextMenu(activeItemElement);
                }
            }
            activeItemElement = null;
        });

        browserListEl.addEventListener('contextmenu', (e) => {
            const item = e.target.closest('.browser-item');
            if (item) {
                e.preventDefault();
                e.stopPropagation();
                triggerContextMenu(item);
            }
        });

        browserListEl.addEventListener('click', (e) => {
            if (ignoreNextClick) {
                ignoreNextClick = false;
                e.stopPropagation();
                e.stopImmediatePropagation();
                e.preventDefault();
            }
        }, true);
    }

    function safeAddListener(selector, event, handler) {
        const el = $(selector);
        if (el) {
            el.addEventListener(event, handler);
        }
    }
    function handleDeletedPath(targetPath, isDir) {
        const pathsToClose = Object.keys(state.openFiles).filter(p => {
            if (isDir) {
                return p === targetPath || p.startsWith(targetPath + '/');
            } else {
                return p === targetPath;
            }
        });
        pathsToClose.forEach(p => {
            if (ctx.closeTab) {
                ctx.closeTab(p, true);
            }
        });
    }

    function handleRenamedPath(oldPath, newPath, isDir) {
        const affectedPaths = Object.keys(state.openFiles).filter(p => {
            if (isDir) {
                return p === oldPath || p.startsWith(oldPath + '/');
            } else {
                return p === oldPath;
            }
        });
        
        if (affectedPaths.length === 0) return;
        
        affectedPaths.forEach(oldP => {
            let targetNewPath = newPath;
            if (isDir && oldP.startsWith(oldPath + '/')) {
                const suffix = oldP.substring(oldPath.length);
                targetNewPath = newPath + suffix;
            }
            
            const tabState = state.openFiles[oldP];
            delete state.openFiles[oldP];
            
            tabState.path = targetNewPath;
            state.openFiles[targetNewPath] = tabState;
            
            const oldDraft = localStorage.getItem(`modie_draft_${oldP}`);
            if (oldDraft) {
                try {
                    const parsed = JSON.parse(oldDraft);
                    parsed.path = targetNewPath;
                    localStorage.setItem(`modie_draft_${targetNewPath}`, JSON.stringify(parsed));
                } catch (e) {
                    localStorage.setItem(`modie_draft_${targetNewPath}`, oldDraft);
                }
                localStorage.removeItem(`modie_draft_${oldP}`);
            }
            
            if (state.activeFilePath === oldP) {
                state.activeFilePath = targetNewPath;
                const titleEl = $('#headerTitle');
                if (titleEl) {
                    titleEl.textContent = targetNewPath.split('/').pop();
                }
                if (ctx.stopWatching) ctx.stopWatching();
                if (ctx.startWatching) ctx.startWatching(targetNewPath);
            }
        });
        
        if (ctx.renderTabs) ctx.renderTabs();
    }

    const closeContextMenu = (isTransitioning = false) => {
        const modalEl = $('#contextMenuModal');
        if (modalEl) {
            modalEl.classList.remove('active');
            if (!isTransitioning && history.state && history.state.modal === 'contextMenuModal') {
                history.back();
            }
        }
        // Reset click interception flag to avoid locking out future folder list clicks
        ignoreNextClick = false;
    };

    safeAddListener('#btnContextRename', 'click', async () => {
        closeContextMenu(true);
        const item = state.contextItem;
        if (!item) return;
        const parts = item.path.split('/');
        const oldName = parts.pop();
        const parentPath = parts.join('/');
        const newName = await ctx.showPrompt('Rename', `Rename "${oldName}" to:`, oldName);
        if (newName && newName !== oldName) {
            const newPath = parentPath ? `${parentPath}/${newName}` : newName;
            api.renameItem(ctx, item.path, newPath).then(() => {
                handleRenamedPath(item.path, newPath, item.isDir);
                api.loadDirectory(ctx, state.currentPath);
            });
        }
    });

    safeAddListener('#btnContextMove', 'click', async () => {
        closeContextMenu(true);
        const item = state.contextItem;
        if (!item) return;
        const newPath = await ctx.showPrompt('Move', `Move "${item.name}" to new path:`, item.path);
        if (newPath && newPath !== item.path) {
            api.renameItem(ctx, item.path, newPath).then(() => {
                handleRenamedPath(item.path, newPath, item.isDir);
                api.loadDirectory(ctx, state.currentPath);
            });
        }
    });

    safeAddListener('#btnContextCopyPath', 'click', () => {
        closeContextMenu();
        const item = state.contextItem;
        if (!item) return;
        navigator.clipboard.writeText(item.path).then(() => {
            ctx.toast('Path copied to clipboard', 'success');
        }).catch(err => {
            ctx.toast('Failed to copy path: ' + err, 'error');
        });
    });

    safeAddListener('#btnContextDelete', 'click', async () => {
        closeContextMenu(true);
        const item = state.contextItem;
        if (!item) return;
        const del = await ctx.showConfirm('Delete Item', `Delete this ${item.isDir ? 'folder' : 'file'}?`);
        if (del) {
            api.deleteItem(ctx, item.path).then(() => {
                handleDeletedPath(item.path, item.isDir);
                api.loadDirectory(ctx, state.currentPath);
            });
        }
    });

    safeAddListener('#btnContextCancel', 'click', () => {
        closeContextMenu();
    });

    safeAddListener('#contextMenuModal', 'click', (e) => {
        const modalEl = $('#contextMenuModal');
        if (modalEl && e.target === modalEl) {
            closeContextMenu();
        }
    });
}
