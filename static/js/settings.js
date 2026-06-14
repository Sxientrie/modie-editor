import * as api from './api.js';
import * as ui from './ui.js';
import { apiGet, apiPost } from './api-client.js';

let ctx = null;
let state = null;
let closeFile = null;

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

export function initSettingsModule(c, s, closeFileFn) {
    ctx = c;
    state = s;
    closeFile = closeFileFn;

    $('#btnSettings').addEventListener('click', () => {
        ui.toggleSettings(ctx);
        updateBackupStorageStats();
    });
    $('#btnSettingsClose').addEventListener('click', () => ui.toggleSettings(ctx));

    $('#btnSettingThemeDark').addEventListener('click', () => {
        ui.applyTheme('dark');
        ui.populateSettings(ctx);
        syncSettingsToServer();
    });
    $('#btnSettingThemeLight').addEventListener('click', () => {
        ui.applyTheme('light');
        ui.populateSettings(ctx);
        syncSettingsToServer();
    });

    $('#btnSettingDensityCompact').addEventListener('click', () => {
        ui.applyDensity('compact');
        ui.populateSettings(ctx);
        syncSettingsToServer();
    });
    $('#btnSettingDensityNormal').addEventListener('click', () => {
        ui.applyDensity('normal');
        ui.populateSettings(ctx);
        syncSettingsToServer();
    });
    $('#btnSettingDensityLarge').addEventListener('click', () => {
        ui.applyDensity('large');
        ui.populateSettings(ctx);
        syncSettingsToServer();
    });

    $('#settingZoomRange').addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        ui.applyZoom(ctx, val);
        $('#settingZoomVal').textContent = val;
    });
    $('#settingZoomRange').addEventListener('change', () => {
        syncSettingsToServer();
    });

    $('#settingToggleHidden').addEventListener('change', (e) => {
        localStorage.setItem('show_hidden', e.target.checked);
        api.loadDirectory(ctx, state.currentPath);
        syncSettingsToServer();
    });
    $('#settingToggleAllFiles').addEventListener('change', (e) => {
        localStorage.setItem('show_all', e.target.checked);
        api.loadDirectory(ctx, state.currentPath);
        syncSettingsToServer();
    });

    $('#settingToggleWordWrap').addEventListener('change', (e) => {
        ui.applyWordWrap(ctx, e.target.checked);
        syncSettingsToServer();
    });

    $('#settingAutoSaveSelect').addEventListener('change', (e) => {
        localStorage.setItem('auto_save_delay', e.target.value);
        syncSettingsToServer();
    });

    $('#settingSearchIgnored').addEventListener('change', (e) => {
        localStorage.setItem('ignored_dirs', e.target.value.trim());
        syncSettingsToServer();
    });

    $('#btnSettingClearDraft').addEventListener('click', () => {
        ui.clearDraft(ctx);
        ctx.toast('Local draft cleared', 'success');
    });

    $('#btnSettingClearAuth').addEventListener('click', async () => {
        const reset = await ctx.showConfirm('Reset Security Token', 'Reset security token? You will need to enter the token printed in your terminal to re-authorize.');
        if (reset) {
            localStorage.removeItem('editor_token');
            window.location.reload();
        }
    });

    $('#btnShowAbout').addEventListener('click', () => {
        ui.toggleSettings(ctx);
        const modal = $('#aboutModal');
        modal.classList.add('active');
        history.pushState({ modal: 'aboutModal' }, '');
        if (window.lucide) {
            window.lucide.createIcons({ nodes: [modal] });
        }
    });

    const closeAboutModal = () => {
        $('#aboutModal').classList.remove('active');
    };

    $('#btnAboutClose').addEventListener('click', closeAboutModal);
    $('#btnAboutConfirm').addEventListener('click', closeAboutModal);
    $('#aboutModal').addEventListener('click', (e) => {
        if (e.target === $('#aboutModal')) {
            closeAboutModal();
        }
    });

    $('#btnAuthSubmit').addEventListener('click', () => {
        const tokenVal = $('#authTokenInput').value.trim();
        if (tokenVal) {
            localStorage.setItem('editor_token', tokenVal);
            $('#authModal').classList.remove('active');
            initSettings();
        }
    });

    $('#settingBackupMaxCount').addEventListener('change', (e) => {
        localStorage.setItem('backup_max_count', e.target.value);
        syncSettingsToServer();
    });

    $('#settingBackupMaxAge').addEventListener('change', (e) => {
        localStorage.setItem('backup_max_age_days', e.target.value);
        syncSettingsToServer();
    });

    $('#btnPurgeAllBackups').addEventListener('click', async () => {
        const confirmed = await ctx.showConfirm(
            'Purge All Backups',
            'Delete all backup files in the backup directory? This action cannot be undone.'
        );
        if (confirmed) {
            try {
                const res = await apiPost('/api/backup-purge');
                ctx.toast(`Deleted ${res.deleted_count} backups`, 'success');
                updateBackupStorageStats();
            } catch (err) {
                if (err.code !== 'auth') {
                    ctx.toast(`Failed to purge backups: ${err.message}`, 'error');
                }
            }
        }
    });
}

export async function updateBackupStorageStats() {
    const infoEl = $('#backupStorageInfo');
    if (!infoEl) return;
    try {
        const stats = await apiGet('/api/backup-stats');
        if (stats) {
            infoEl.textContent = `Total: ${stats.total_count} backups (${ctx.formatBytes(stats.total_size_bytes)})`;
        }
    } catch (e) {
        infoEl.textContent = 'Backups: stats unavailable';
    }
}

export function syncSettingsToServer() {
    const theme = ui.getTheme();
    const zoom = ui.getZoom();
    const showHidden = localStorage.getItem('show_hidden') === 'true';
    const showAll = localStorage.getItem('show_all') === 'true';
    const autoSaveDelay = parseInt(localStorage.getItem('auto_save_delay') || '500', 10);
    const wordWrap = ui.getWordWrap();
    const browserDensity = ui.getDensity();
    const ignoredDirs = localStorage.getItem('ignored_dirs') || 'node_modules, venv, .venv, __pycache__, dist, build, target';
    const backupMaxCount = parseInt(localStorage.getItem('backup_max_count') || '10', 10);
    const backupMaxAge = parseInt(localStorage.getItem('backup_max_age_days') || '30', 10);

    api.saveSettings(ctx, {
        theme,
        zoom,
        show_hidden: showHidden,
        show_all: showAll,
        auto_save_delay: autoSaveDelay,
        word_wrap: wordWrap,
        browser_density: browserDensity,
        ignored_dirs: ignoredDirs,
        backup_max_count: backupMaxCount,
        backup_max_age_days: backupMaxAge,
        starred_items: state.starredItems || [],
        recent_files: state.recentFiles || []
    });
}

export async function initSettings() {
    window.lucide.createIcons();
    const serverSettings = await api.getSettings(ctx);
    if (serverSettings) {
        state.starredItems = serverSettings.starred_items || [];
        state.recentFiles = serverSettings.recent_files || [];
        localStorage.setItem('show_hidden', serverSettings.show_hidden);
        localStorage.setItem('show_all', serverSettings.show_all);
        localStorage.setItem('auto_save_delay', serverSettings.auto_save_delay);
        localStorage.setItem('word_wrap', serverSettings.word_wrap);
        localStorage.setItem('ignored_dirs', serverSettings.ignored_dirs || 'node_modules, venv, .venv, __pycache__, dist, build, target');
        localStorage.setItem('backup_max_count', serverSettings.backup_max_count ?? '10');
        localStorage.setItem('backup_max_age_days', serverSettings.backup_max_age_days ?? '30');
        ui.applyTheme(serverSettings.theme);
        ui.applyZoom(ctx, serverSettings.zoom);
        ui.applyWordWrap(ctx, serverSettings.word_wrap);
        ui.applyDensity(serverSettings.browser_density || 'normal');
        const selectMaxCount = $('#settingBackupMaxCount');
        if (selectMaxCount) selectMaxCount.value = serverSettings.backup_max_count ?? '10';
        const selectMaxAge = $('#settingBackupMaxAge');
        if (selectMaxAge) selectMaxAge.value = serverSettings.backup_max_age_days ?? '30';
    } else {
        ui.applyZoom(ctx, ui.getZoom());
        ui.applyTheme(ui.getTheme());
        ui.applyWordWrap(ctx, ui.getWordWrap());
        ui.applyDensity(ui.getDensity());
    }
    $('#btnFindCase').classList.toggle('active', state.findCaseSensitive);
    $('#btnFindWord').classList.toggle('active', state.findWholeWord);
    $('#btnFindRegex').classList.toggle('active', state.findRegex);
    $('#btnGlobalSearchCase').classList.toggle('active', state.globalSearchCaseSensitive);
    $('#btnGlobalSearchRegex').classList.toggle('active', state.globalSearchRegex);

    if (!localStorage.getItem('editor_token')) {
        $('#authModal').classList.add('active');
        $('#authTokenInput').focus();
    } else {
        const savedStateRaw = localStorage.getItem('modie_workspace_state');
        let restored = false;
        if (savedStateRaw) {
            try {
                const workspace = JSON.parse(savedStateRaw);
                if (workspace && Array.isArray(workspace.openFiles) && workspace.openFiles.length > 0) {
                    const { restoreWorkspace } = await import('./tabs.js');
                    restored = await restoreWorkspace(workspace);
                }
            } catch (e) {
                console.error('Failed to restore workspace', e);
            }
        }
        if (!restored) {
            await closeFile(false);
            api.loadDirectory(ctx, '');
        }
        ui.cleanupOrphanDrafts(ctx);
    }
}
