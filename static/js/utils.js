export function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export function diffLines(oldText, newText) {
    const a = oldText.split('\n');
    const b = newText.split('\n');
    
    let prefixCount = 0;
    while (prefixCount < a.length && prefixCount < b.length && a[prefixCount] === b[prefixCount]) {
        prefixCount++;
    }
    
    let suffixCount = 0;
    while (suffixCount < (a.length - prefixCount) && suffixCount < (b.length - prefixCount) && a[a.length - 1 - suffixCount] === b[b.length - 1 - suffixCount]) {
        suffixCount++;
    }
    
    const midA = a.slice(prefixCount, a.length - suffixCount);
    const midB = b.slice(prefixCount, b.length - suffixCount);
    
    const n = midA.length, m = midB.length;
    const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
    for (let i = 1; i <= n; i++) {
        for (let j = 1; j <= m; j++) {
            if (midA[i - 1] === midB[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
            else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
    }
    
    const midResult = [];
    let i = n, j = m;
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && midA[i - 1] === midB[j - 1]) {
            midResult.unshift({ type: 'unchanged', text: midA[i - 1] });
            i--; j--;
        } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
            midResult.unshift({ type: 'added', text: midB[j - 1] });
            j--;
        } else {
            midResult.unshift({ type: 'deleted', text: midA[i - 1] });
            i--;
        }
    }
    
    const result = [];
    for (let k = 0; k < prefixCount; k++) {
        result.push({ type: 'unchanged', text: a[k] });
    }
    result.push(...midResult);
    for (let k = a.length - suffixCount; k < a.length; k++) {
        result.push({ type: 'unchanged', text: a[k] });
    }
    
    return result;
}
