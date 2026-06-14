import { apiGet, apiPost } from './api-client.js';

export function setupGlobalReplace(ctx) {
    const btnReplaceAll = document.querySelector('#btnGlobalReplaceAll');
    if (!btnReplaceAll) return;
    btnReplaceAll.addEventListener('click', async () => {
        const query = document.querySelector('#globalSearchInput').value.trim();
        const replace = document.querySelector('#globalReplaceInput').value;
        if (!query) {
            ctx.toast('Please enter a search query', 'error');
            return;
        }
        const items = document.querySelectorAll('.browser-item.search-result-item');
        const filePaths = Array.from(new Set(Array.from(items).map(item => item.dataset.path)));
        if (filePaths.length === 0) {
            ctx.toast('No matching files to replace', 'error');
            return;
        }
        const confirmed = await ctx.showConfirm(
            'Global Replace All',
            `Replace all occurrences of "${query}" with "${replace}" in ${filePaths.length} file(s)?`
        );
        if (!confirmed) return;
        try {
            ctx.setStatus('saving', 'Replacing...');
            const data = await apiPost('/api/replace', {
                query,
                replace,
                files: filePaths,
                case_sensitive: ctx.state.globalSearchCaseSensitive,
                is_regex: ctx.state.globalSearchRegex
            }, { ctx });
            if (data.ok && data.task_id) {
                const taskId = data.task_id;
                const poll = async () => {
                    try {
                        const statusData = await apiGet('/api/replace/status', { task_id: taskId }, { ctx });
                        if (statusData.status === 'done') {
                            ctx.setStatus('saved', 'Replace complete');
                            ctx.toast(`Successfully replaced in ${statusData.replaced_files} file(s)`, 'success');
                            // Architectural decision: Warn the user if backup or write errors occurred in the background task
                            // so edits are not silently applied without backups.
                            if (statusData.errors && statusData.errors.length > 0) {
                                ctx.toast(`Replace warning: ${statusData.errors.length} error(s)/warning(s) occurred. Check browser console.`, 'warning');
                                statusData.errors.forEach(err => console.warn('[Global Replace Warning]', err));
                            }
                            document.querySelector('#globalReplaceInput').value = '';
                            const searchInput = document.querySelector('#globalSearchInput');
                            if (searchInput) {
                                searchInput.dispatchEvent(new Event('input'));
                            }
                        } else if (statusData.status === 'running') {
                            setTimeout(poll, 500);
                        } else {
                            ctx.setStatus('error', 'Replace failed');
                            ctx.toast('Replace failed', 'error');
                        }
                    } catch (pollErr) {
                        ctx.setStatus('error', 'Replace failed');
                        ctx.toast(`Replace failed: ${pollErr.message}`, 'error');
                    }
                };
                setTimeout(poll, 500);
            } else {
                ctx.setStatus('error', 'Replace failed');
                ctx.toast('Replace failed to initialize', 'error');
            }
        } catch (err) {
            if (err.code !== 'auth') {
                ctx.setStatus('error', 'Replace failed');
                ctx.toast(`Replace failed: ${err.message}`, 'error');
            }
        }
    });
}

