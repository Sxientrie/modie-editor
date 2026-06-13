export function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function lcsLength(A, B, reverse = false) {
    const aLen = A.length;
    const bLen = B.length;
    let prev = new Int32Array(bLen + 1);
    let curr = new Int32Array(bLen + 1);
    for (let i = 1; i <= aLen; i++) {
        const temp = prev;
        prev = curr;
        curr = temp;
        curr.fill(0);
        const aVal = A[reverse ? aLen - i : i - 1];
        for (let j = 1; j <= bLen; j++) {
            const bVal = B[reverse ? bLen - j : j - 1];
            if (aVal === bVal) {
                curr[j] = prev[j - 1] + 1;
            } else {
                const val1 = prev[j];
                const val2 = curr[j - 1];
                curr[j] = val1 > val2 ? val1 : val2;
            }
        }
    }
    return curr;
}

function hirschberg(A, B) {
    if (A.length === 0) {
        return B.map(x => ({ type: 'added', text: x }));
    }
    if (B.length === 0) {
        return A.map(x => ({ type: 'deleted', text: x }));
    }
    if (A.length === 1) {
        const idx = B.indexOf(A[0]);
        if (idx !== -1) {
            const before = B.slice(0, idx).map(x => ({ type: 'added', text: x }));
            const match = { type: 'unchanged', text: A[0] };
            const after = B.slice(idx + 1).map(x => ({ type: 'added', text: x }));
            return [...before, match, ...after];
        } else {
            return [
                { type: 'deleted', text: A[0] },
                ...B.map(x => ({ type: 'added', text: x }))
            ];
        }
    }
    const midA = Math.floor(A.length / 2);
    const AL = A.slice(0, midA);
    const AR = A.slice(midA);
    const L1 = lcsLength(AL, B, false);
    const L2 = lcsLength(AR, B, true);
    let maxVal = -1;
    let splitB = 0;
    for (let j = 0; j <= B.length; j++) {
        const val = L1[j] + L2[B.length - j];
        if (val > maxVal) {
            maxVal = val;
            splitB = j;
        }
    }
    const BL = B.slice(0, splitB);
    const BR = B.slice(splitB);
    return [...hirschberg(AL, BL), ...hirschberg(AR, BR)];
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
    const midResult = hirschberg(midA, midB);
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
