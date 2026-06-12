import { apiPost } from './api-client.js';

export async function createItem(ctx, parentPath, name, isDir) {
    try {
        ctx.setStatus('saving', 'Creating...');
        await apiPost('/api/create', { path: parentPath, name, is_dir: isDir }, { ctx });
        ctx.setStatus('saved', 'Created');
        ctx.toast(`${isDir ? 'Folder' : 'File'} created`, 'success');
    } catch (err) {
        if (err.code !== 'auth') {
            ctx.setStatus('error', 'Create failed');
            ctx.toast(`Failed to create: ${err.message}`, 'error');
        }
    }
}

export async function deleteItem(ctx, path) {
    try {
        ctx.setStatus('saving', 'Deleting...');
        await apiPost('/api/delete', { path }, { ctx });
        ctx.setStatus('saved', 'Deleted');
        ctx.toast('Item deleted', 'success');
    } catch (err) {
        if (err.code !== 'auth') {
            ctx.setStatus('error', 'Delete failed');
            ctx.toast(`Failed to delete: ${err.message}`, 'error');
        }
    }
}

export async function renameItem(ctx, path, newPath) {
    try {
        ctx.setStatus('saving', 'Moving...');
        await apiPost('/api/rename', { path, new_path: newPath }, { ctx });
        ctx.setStatus('saved', 'Moved');
        ctx.toast('Item renamed/moved successfully', 'success');
    } catch (err) {
        if (err.code !== 'auth') {
            ctx.setStatus('error', 'Move failed');
            ctx.toast(`Failed to move: ${err.message}`, 'error');
            throw err;
        }
    }
}
