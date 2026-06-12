import * as apiGit from './api-git.js';
import { escapeHtml } from './utils.js';

let ctx = null;
let state = null;
const $ = (s) => document.querySelector(s);

export function initGit(c, s) {
    ctx = c;
    state = s;
    setupGitListeners();
}

function getContextPath() {
    if (state.activeFilePath) {
        return state.activeFilePath;
    }
    return state.currentPath || '';
}

export async function refreshGitStatus() {
    const gitPanel = $('#panelGit');
    if (!gitPanel || state.currentTab !== 'git') return;

    const path = getContextPath();
    const data = await apiGit.getGitStatus(ctx, path);

    if (!data) {
        gitPanel.innerHTML = `
            <div class="empty-state">
                <i data-lucide="alert-triangle"></i>
                <p>Failed to connect to Git server API</p>
            </div>`;
        window.lucide.createIcons({ nodes: [gitPanel] });
        return;
    }

    if (!data.git_installed) {
        gitPanel.innerHTML = `
            <div class="git-setup-screen">
                <i data-lucide="alert-circle"></i>
                <h3>Git Not Installed</h3>
                <p>Git is not available in your Termux environment. Run the following command in Termux to install it:</p>
                <code style="background:var(--bg); padding:6px; border:1px solid var(--border); border-radius:var(--radius-sm); font-size:11px; font-family:var(--font-mono); margin-top:8px;">pkg install git</code>
            </div>`;
        window.lucide.createIcons({ nodes: [gitPanel] });
        return;
    }

    if (!data.in_repo) {
        gitPanel.innerHTML = `
            <div class="git-setup-screen">
                <i data-lucide="git-fork"></i>
                <h3>Not a Git Repository</h3>
                <p>The current directory is not tracked by Git. Click below to initialize a Git repository here.</p>
                <button class="btn btn-primary" id="btnGitInit">Initialize Repository</button>
            </div>`;
        window.lucide.createIcons({ nodes: [gitPanel] });
        
        $('#btnGitInit').addEventListener('click', async () => {
            const success = await apiGit.initGitRepo(ctx, path);
            if (success) refreshGitStatus();
        });
        return;
    }

    renderGitWorkspace(data);
}

function renderGitWorkspace(data) {
    const gitPanel = $('#panelGit');
    if (!gitPanel) return;

    const totalChanges = data.staged.length + data.unstaged.length + data.untracked.length;

    gitPanel.innerHTML = `
        <div class="git-container">
            <div class="git-header">
                <span class="git-branch-info">
                    <i data-lucide="git-branch"></i>
                    <span>${escapeHtml(data.branch)}</span>
                </span>
                <button class="icon-btn" id="btnGitRefresh" title="Refresh Git Status"><i data-lucide="rotate-cw"></i></button>
            </div>
            <div class="git-content">
                ${renderSection('Staged Changes', data.staged, true)}
                ${renderSection('Unstaged Changes', data.unstaged, false)}
                ${renderUntrackedSection('Untracked Files', data.untracked)}
                ${totalChanges === 0 ? `
                    <div class="empty-state" style="padding:40px 0;">
                        <i data-lucide="check-circle-2"></i>
                        <p>No changes detected</p>
                        <p class="hint">Clean working directory</p>
                    </div>` : ''}
            </div>
            <div class="git-commit-box">
                <textarea class="git-commit-textarea" id="gitCommitMsg" placeholder="Commit message..." autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="send"></textarea>
                <button class="btn btn-primary" id="btnGitCommit" ${data.staged.length === 0 ? 'disabled' : ''} style="justify-content:center;">
                    <i data-lucide="check"></i> Commit Staged (${data.staged.length})
                </button>
            </div>
        </div>
    `;

    window.lucide.createIcons({ nodes: [gitPanel] });

    $('#btnGitRefresh').addEventListener('click', refreshGitStatus);
    
    $('#btnGitCommit').addEventListener('click', async () => {
        const msgInput = $('#gitCommitMsg');
        const msg = msgInput.value.trim();
        if (!msg) {
            ctx.toast('Please enter a commit message', 'warning');
            return;
        }
        const success = await apiGit.commitChanges(ctx, getContextPath(), msg);
        if (success) {
            msgInput.value = '';
            refreshGitStatus();
        }
    });

    gitPanel.querySelectorAll('.git-file-checkbox').forEach(cb => {
        cb.addEventListener('change', async (e) => {
            const filePath = cb.dataset.path;
            const stage = cb.checked;
            cb.disabled = true;
            const success = await apiGit.stageFile(ctx, getContextPath(), filePath, stage);
            if (success) {
                refreshGitStatus();
            } else {
                cb.disabled = false;
                cb.checked = !stage;
            }
        });
    });

    gitPanel.querySelectorAll('.git-file-header').forEach(header => {
        header.addEventListener('click', (e) => {
            if (e.target.classList.contains('git-file-checkbox')) return;
            const item = header.closest('.git-file-item');
            const filePath = header.dataset.path;
            const isStaged = header.dataset.staged === 'true';
            const isUntracked = header.dataset.untracked === 'true';
            toggleDiff(item, filePath, isStaged, isUntracked);
        });
    });
}

function renderSection(title, files, isStaged) {
    if (files.length === 0) return '';
    return `
        <div class="git-section">
            <span class="git-section-title">${title} (${files.length})</span>
            <div class="git-file-list">
                ${files.map(f => `
                    <div class="git-file-item" data-path="${escapeHtml(f.path)}">
                        <div class="git-file-header" data-path="${escapeHtml(f.path)}" data-staged="${isStaged}" data-untracked="false">
                            <input type="checkbox" class="git-file-checkbox" data-path="${escapeHtml(f.path)}" ${isStaged ? 'checked' : ''} />
                            <div class="git-file-info">
                                <span class="git-file-name">${escapeHtml(f.path.split('/').pop())}</span>
                                <span class="git-file-path">${escapeHtml(f.path)}</span>
                            </div>
                            <span class="git-status-badge ${escapeHtml(f.status.toLowerCase())}">${escapeHtml(f.status)}</span>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

function renderUntrackedSection(title, files) {
    if (files.length === 0) return '';
    return `
        <div class="git-section">
            <span class="git-section-title">${title} (${files.length})</span>
            <div class="git-file-list">
                ${files.map(f => `
                    <div class="git-file-item" data-path="${escapeHtml(f)}">
                        <div class="git-file-header" data-path="${escapeHtml(f)}" data-staged="false" data-untracked="true">
                            <input type="checkbox" class="git-file-checkbox" data-path="${escapeHtml(f)}" />
                            <div class="git-file-info">
                                <span class="git-file-name">${escapeHtml(f.split('/').pop())}</span>
                                <span class="git-file-path">${escapeHtml(f)}</span>
                            </div>
                            <span class="git-status-badge u">??</span>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

async function toggleDiff(itemElement, filePath, isStaged, isUntracked) {
    let diffContainer = itemElement.querySelector('.git-diff-container');
    if (diffContainer) {
        diffContainer.remove();
        return;
    }

    diffContainer = document.createElement('div');
    diffContainer.className = 'git-diff-container';
    diffContainer.innerHTML = '<span style="color:var(--text-muted)">Loading diff...</span>';
    itemElement.appendChild(diffContainer);

    if (isUntracked) {
        diffContainer.innerHTML = '<span style="color:var(--text-muted)">New untracked file (no diff available)</span>';
        return;
    }

    const diff = await apiGit.getGitDiff(ctx, getContextPath(), filePath, isStaged);
    if (diff === null) {
        diffContainer.innerHTML = '<span style="color:var(--destructive)">Failed to load diff</span>';
        return;
    }

    if (!diff.trim()) {
        diffContainer.innerHTML = '<span style="color:var(--text-muted)">No changes or binary file</span>';
        return;
    }

    const diffLines = diff.split('\n').map(line => {
        let className = 'git-diff-line';
        if (line.startsWith('+') && !line.startsWith('+++')) className += ' addition';
        else if (line.startsWith('-') && !line.startsWith('---')) className += ' deletion';
        else if (line.startsWith('@@')) className += ' meta';
        return `<span class="${className}">${escapeHtml(line)}</span>`;
    }).join('');

    diffContainer.innerHTML = diffLines;
}

function setupGitListeners() {
    ctx.subscribe((prop, value) => {
        if (prop === 'currentTab' && value === 'git') {
            refreshGitStatus();
        }
    });
    
    ctx.subscribe((prop, value) => {
        if (prop === 'isDirty' && value === false && state.currentTab === 'git') {
            setTimeout(refreshGitStatus, 500);
        }
    });
}
