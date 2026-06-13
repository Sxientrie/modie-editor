import { apiGet, apiPost } from './api-client.js';
import * as ui from './ui.js';

const $ = (s) => document.querySelector(s);

export function setupGlobalSearchUI(ctx, state, api) {
    function runGlobalSearch() {
        const query = $('#globalSearchInput').value.trim();
        if (!query) {
            $('#globalSearchCount').textContent = '';
            api.loadDirectory(ctx, state.currentPath);
            return;
        }
        api.searchFiles(ctx, query, state.currentPath, state.globalSearchCaseSensitive, state.globalSearchRegex);
    }

    const toggleBtn = $('#btnGlobalSearchToggle');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            const searchBar = $('#browserSearchBar');
            const filterBar = $('#browserFilterBar');
            const filterBtn = $('#btnBrowserFilterToggle');
            if (searchBar) {
                const isActive = searchBar.classList.toggle('active');
                toggleBtn.classList.toggle('active', isActive);
                if (isActive) {
                    if (filterBar) {
                        filterBar.classList.remove('active');
                        filterBtn.classList.remove('active');
                        $('#browserFilterInput').value = '';
                        ui.filterBrowserItems('');
                    }
                    const searchInput = $('#globalSearchInput');
                    searchInput.value = '';
                    $('#globalSearchCount').textContent = '';
                    searchInput.focus();
                } else {
                    $('#globalSearchInput').value = '';
                    $('#globalSearchCount').textContent = '';
                    api.loadDirectory(ctx, state.currentPath);
                }
            }
        });
    }

    const clearBtn = $('#btnBrowserSearchClear');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            const searchInput = $('#globalSearchInput');
            if (searchInput) searchInput.value = '';
            $('#globalSearchCount').textContent = '';
            const searchBar = $('#browserSearchBar');
            if (searchBar) searchBar.classList.remove('active');
            $('#btnGlobalSearchToggle').classList.remove('active');
            api.loadDirectory(ctx, state.currentPath);
        });
    }

    let globalSearchTimeout = null;
    const searchInput = $('#globalSearchInput');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            clearTimeout(globalSearchTimeout);
            globalSearchTimeout = setTimeout(runGlobalSearch, 300);
        });
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') $('#btnBrowserSearchClear').click();
            else if (e.key === 'Enter') { e.preventDefault(); runGlobalSearch(); }
        });
    }

    const caseBtn = $('#btnGlobalSearchCase');
    if (caseBtn) {
        caseBtn.addEventListener('click', () => {
            state.globalSearchCaseSensitive = !state.globalSearchCaseSensitive;
            localStorage.setItem('global_search_case_sensitive', state.globalSearchCaseSensitive);
            caseBtn.classList.toggle('active', state.globalSearchCaseSensitive);
            runGlobalSearch();
        });
    }

    const regexBtn = $('#btnGlobalSearchRegex');
    if (regexBtn) {
        regexBtn.addEventListener('click', () => {
            state.globalSearchRegex = !state.globalSearchRegex;
            localStorage.setItem('global_search_regex', state.globalSearchRegex);
            regexBtn.classList.toggle('active', state.globalSearchRegex);
            runGlobalSearch();
        });
    }
}
