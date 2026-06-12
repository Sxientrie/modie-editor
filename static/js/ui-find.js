import { updateLineNumbers, updateDirtyState, updateWordCount, handleAutoSave } from './ui.js';
import { pushState } from './undo.js';


export function toggleFind(ctx) {
    const active = ctx.findBar.classList.toggle('active');
    ctx.editor.classList.toggle('find-active', active);
    if (active) {
        ctx.findInput.focus();
        ctx.findInput.select();
    } else {
        ctx.findCount.textContent = '';
        ctx.editor.focus();
    }
}

export function doFind(ctx, dir = 1) {
    const q = ctx.findInput.value;
    ctx.findInput.classList.remove('invalid-regex');
    if (!q) {
        ctx.findCount.textContent = '';
        ctx.state.findMatches = [];
        return;
    }
    let pattern = q;
    if (!ctx.state.findRegex) {
        pattern = q.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    }
    if (ctx.state.findWholeWord) {
        pattern = `\\b${pattern}\\b`;
    }
    let flags = 'g';
    if (!ctx.state.findCaseSensitive) {
        flags += 'i';
    }
    let regex;
    try {
        regex = new RegExp(pattern, flags);
    } catch (err) {
        ctx.findInput.classList.add('invalid-regex');
        ctx.findCount.textContent = 'Invalid regex';
        ctx.state.findMatches = [];
        return;
    }
    const text = ctx.editor.value;
    ctx.state.findMatches = [];
    let match;
    regex.lastIndex = 0;
    while ((match = regex.exec(text)) !== null) {
        ctx.state.findMatches.push({
            index: match.index,
            length: match[0].length
        });
        if (regex.lastIndex === match.index) {
            regex.lastIndex++;
        }
    }
    if (!ctx.state.findMatches.length) {
        ctx.findCount.textContent = '0 results';
        return;
    }
    const cur = ctx.editor.selectionStart;
    if (dir === 1) {
        ctx.state.findIndex = ctx.state.findMatches.findIndex(m => m.index > cur);
        if (ctx.state.findIndex === -1) ctx.state.findIndex = 0;
    } else {
        ctx.state.findIndex = ctx.state.findMatches.length - 1;
        for (let j = ctx.state.findMatches.length - 1; j >= 0; j--) {
            if (ctx.state.findMatches[j].index < cur - 1) {
                ctx.state.findIndex = j;
                break;
            }
        }
    }
    const matchObj = ctx.state.findMatches[ctx.state.findIndex];
    ctx.editor.setSelectionRange(matchObj.index, matchObj.index + matchObj.length);
    const lh = parseFloat(getComputedStyle(ctx.editor).lineHeight);
    const linesBefore = ctx.editor.value.substring(0, matchObj.index).split('\n').length;
    ctx.editor.scrollTop = (linesBefore - 3) * lh;
    ctx.findCount.textContent = `${ctx.state.findIndex + 1} / ${ctx.state.findMatches.length}`;
}

export function handleFormat(ctx, btn) {
    const ins = btn.dataset.insert;
    const suffix = btn.dataset.suffix || '';
    const wrap = btn.dataset.wrap === 'true';
    const s = ctx.editor.selectionStart, e = ctx.editor.selectionEnd;
    const sel = ctx.editor.value.substring(s, e);
    let rep;
    if (wrap && sel) rep = ins + sel + ins;
    else if (suffix) rep = ins + sel + suffix;
    else rep = ins + sel;
    ctx.editor.focus();
    ctx.editor.setSelectionRange(s, e);
    document.execCommand('insertText', false, rep);
    updateLineNumbers(ctx);
    updateDirtyState(ctx);
    updateWordCount(ctx);
    if (ctx.state.activeFilePath && ctx.state.openFiles[ctx.state.activeFilePath]) {
        ctx.state.openFiles[ctx.state.activeFilePath].content = ctx.editor.value;
        pushState(ctx.state.activeFilePath, ctx.editor.value, ctx.editor.selectionStart, ctx.editor.selectionEnd);
    }
}

export function doReplace(ctx) {
    const q = ctx.findInput.value;
    if (!q) return;
    const replaceInput = document.querySelector('#replaceInput');
    const replaceVal = replaceInput ? replaceInput.value : '';
    const start = ctx.editor.selectionStart;
    const end = ctx.editor.selectionEnd;
    const isMatch = ctx.state.findMatches.some(m => m.index === start && m.length === (end - start));
    if (isMatch) {
        ctx.editor.focus();
        ctx.editor.setSelectionRange(start, end);
        document.execCommand('insertText', false, replaceVal);
        updateLineNumbers(ctx);
        updateDirtyState(ctx);
        updateWordCount(ctx);
        handleAutoSave(ctx);
        if (ctx.state.activeFilePath && ctx.state.openFiles[ctx.state.activeFilePath]) {
            ctx.state.openFiles[ctx.state.activeFilePath].content = ctx.editor.value;
            pushState(ctx.state.activeFilePath, ctx.editor.value, ctx.editor.selectionStart, ctx.editor.selectionEnd);
        }
    }
    doFind(ctx, 1);
}

export function doReplaceAll(ctx) {
    const q = ctx.findInput.value;
    if (!q) return;
    const replaceInput = document.querySelector('#replaceInput');
    const replaceVal = replaceInput ? replaceInput.value : '';
    let pattern = q;
    if (!ctx.state.findRegex) {
        pattern = q.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    }
    if (ctx.state.findWholeWord) {
        pattern = `\\b${pattern}\\b`;
    }
    let flags = 'g';
    if (!ctx.state.findCaseSensitive) {
        flags += 'i';
    }
    let regex;
    try {
        regex = new RegExp(pattern, flags);
    } catch (err) {
        return;
    }
    const val = ctx.editor.value;
    let newVal;
    if (ctx.state.findRegex) {
        newVal = val.replace(regex, replaceVal);
    } else {
        newVal = val.replace(regex, () => replaceVal);
    }
    if (val !== newVal) {
        const start = ctx.editor.selectionStart;
        ctx.editor.focus();
        ctx.editor.setSelectionRange(0, val.length);
        document.execCommand('insertText', false, newVal);
        ctx.editor.setSelectionRange(start, start);
        updateLineNumbers(ctx);
        updateDirtyState(ctx);
        updateWordCount(ctx);
        handleAutoSave(ctx);
        if (ctx.state.activeFilePath && ctx.state.openFiles[ctx.state.activeFilePath]) {
            ctx.state.openFiles[ctx.state.activeFilePath].content = ctx.editor.value;
            pushState(ctx.state.activeFilePath, ctx.editor.value, ctx.editor.selectionStart, ctx.editor.selectionEnd);
        }
    }
    doFind(ctx, 1);
}

export function setupFind(ctx) {
    const $ = (s) => document.querySelector(s);
    $('#btnFind').addEventListener('click', () => toggleFind(ctx));
    $('#btnFindClose').addEventListener('click', () => toggleFind(ctx));
    $('#btnFindNext').addEventListener('click', () => doFind(ctx, 1));
    $('#btnFindPrev').addEventListener('click', () => doFind(ctx, -1));
    $('#btnReplace').addEventListener('click', () => doReplace(ctx));
    $('#btnReplaceAll').addEventListener('click', () => doReplaceAll(ctx));
    $('#replaceInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            doReplace(ctx);
        }
    });
    $('#btnFindCase').addEventListener('click', () => {
        ctx.state.findCaseSensitive = !ctx.state.findCaseSensitive;
        localStorage.setItem('find_case_sensitive', ctx.state.findCaseSensitive);
        $('#btnFindCase').classList.toggle('active', ctx.state.findCaseSensitive);
        doFind(ctx, 1);
    });
    $('#btnFindWord').addEventListener('click', () => {
        ctx.state.findWholeWord = !ctx.state.findWholeWord;
        localStorage.setItem('find_whole_word', ctx.state.findWholeWord);
        $('#btnFindWord').classList.toggle('active', ctx.state.findWholeWord);
        doFind(ctx, 1);
    });
    $('#btnFindRegex').addEventListener('click', () => {
        ctx.state.findRegex = !ctx.state.findRegex;
        localStorage.setItem('find_regex', ctx.state.findRegex);
        $('#btnFindRegex').classList.toggle('active', ctx.state.findRegex);
        doFind(ctx, 1);
    });

    let findTimeout = null;
    ctx.findInput.addEventListener('input', () => {
        if (findTimeout) clearTimeout(findTimeout);
        findTimeout = setTimeout(() => doFind(ctx, 1), 250);
    });
    ctx.findInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doFind(ctx, e.shiftKey ? -1 : 1);
    });
}
