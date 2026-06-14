import assert from 'assert';

let mockStorage = {};
global.localStorage = {
    getItem(key) { return mockStorage[key] || null; },
    setItem(key, value) { mockStorage[key] = String(value); }
};

const mockStyle = {};
const mockEditor = {
    style: mockStyle
};
const mockLineNumbers = {
    style: {}
};
const mockPreview = {
    style: {}
};

global.document = {
    documentElement: {
        setAttribute() {}
    },
    querySelector(sel) {
        return { content: '' };
    }
};

global.getComputedStyle = () => {
    return { lineHeight: '1.5' };
};

async function runTests() {
    const { getZoom, applyZoom } = await import('../static/js/ui.js');

    mockStorage = {};
    assert.strictEqual(getZoom(), 14);

    mockStorage['modie_zoom'] = '24';
    assert.strictEqual(getZoom(), 24);

    const ctx = {
        editor: mockEditor,
        lineNumbers: mockLineNumbers,
        preview: mockPreview
    };
    applyZoom(ctx, 20);
    assert.strictEqual(mockStorage['modie_zoom'], '20');
    assert.strictEqual(mockEditor.style.fontSize, '20px');

    applyZoom(ctx, 4);
    assert.strictEqual(mockStorage['modie_zoom'], '8');
    assert.strictEqual(mockEditor.style.fontSize, '8px');

    applyZoom(ctx, 60);
    assert.strictEqual(mockStorage['modie_zoom'], '48');
    assert.strictEqual(mockEditor.style.fontSize, '48px');

    console.log('[PASS] Zoom range limits and behavior verified.');
}

runTests().catch(err => {
    console.error(err);
    process.exit(1);
});
