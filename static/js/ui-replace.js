import { apiPost } from './api-client.js';

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
            if (data.ok) {
                ctx.toast(`Successfully replaced in ${data.replaced_files} file(s)`, 'success');
                document.querySelector('#globalReplaceInput').value = '';
                const searchInput = document.querySelector('#globalSearchInput');
                if (searchInput) {
                    searchInput.dispatchEvent(new Event('input'));
                }
            } else {
                ctx.toast('Replace failed', 'error');
            }
        } catch (err) {
            if (err.code !== 'auth') {
                ctx.setStatus('error', 'Replace failed');
                ctx.toast(`Replace failed: ${err.message}`, 'error');
            }
        }
    });
}
