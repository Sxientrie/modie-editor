import { apiGet, apiPost } from './api-client.js';

export async function getGitStatus(ctx, path) {
    try {
        return await apiGet('/api/git/status', { path }, { ctx });
    } catch (err) {
        if (err.code !== 'auth') {
            ctx.toast(`Failed to fetch Git status: ${err.message}`, 'error');
        }
        return null;
    }
}

export async function stageFile(ctx, path, filePath, stage) {
    try {
        await apiPost('/api/git/stage', { path, file_path: filePath, stage }, { ctx });
        return true;
    } catch (err) {
        if (err.code !== 'auth') {
            ctx.toast(`Failed to stage/unstage file: ${err.message}`, 'error');
        }
        return false;
    }
}

export async function commitChanges(ctx, path, message) {
    try {
        ctx.setStatus('saving', 'Committing...');
        await apiPost('/api/git/commit', { path, message }, { ctx });
        ctx.setStatus('saved', 'Committed');
        ctx.toast('Commit successful', 'success');
        return true;
    } catch (err) {
        if (err.code !== 'auth') {
            ctx.setStatus('error', 'Commit failed');
            ctx.toast(`Commit failed: ${err.message}`, 'error');
        }
        return false;
    }
}

export async function getGitDiff(ctx, path, filePath, staged) {
    try {
        const data = await apiGet('/api/git/diff', { path, file_path: filePath, staged }, { ctx });
        return data.diff;
    } catch (err) {
        if (err.code !== 'auth') {
            ctx.toast(`Failed to fetch diff: ${err.message}`, 'error');
        }
        return null;
    }
}

export async function initGitRepo(ctx, path) {
    try {
        ctx.setStatus('saving', 'Initializing Git...');
        await apiPost('/api/git/init', { path }, { ctx });
        ctx.setStatus('saved', 'Git initialized');
        ctx.toast('Git repository initialized successfully', 'success');
        return true;
    } catch (err) {
        if (err.code !== 'auth') {
            ctx.setStatus('error', 'Init failed');
            ctx.toast(`Failed to initialize Git: ${err.message}`, 'error');
        }
        return false;
    }
}
