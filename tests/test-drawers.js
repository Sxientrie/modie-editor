import assert from 'assert';

class MockElement {
    constructor(id) {
        this.id = id;
        this.classList = {
            classes: new Set(),
            add(c) { this.classes.add(c); },
            remove(c) { this.classes.delete(c); },
            toggle(c, force) {
                if (force !== undefined) {
                    if (force) this.classes.add(c);
                    else this.classes.delete(c);
                    return force;
                }
                const has = this.classes.has(c);
                if (has) this.classes.delete(c);
                else this.classes.add(c);
                return !has;
            },
            contains(c) { return this.classes.has(c); }
        };
        this.style = {};
        this.value = '';
        this.children = [];
    }
    addEventListener() {}
    removeEventListener() {}
    appendChild(el) {
        this.children.push(el);
    }
    querySelectorAll() { return []; }
    focus() {}
    setAttribute() {}
    remove() {}
}

const mockElements = {
    '#outlineDrawer': new MockElement('outlineDrawer'),
    '#settingsDrawer': new MockElement('settingsDrawer'),
    '#drawerOverlay': new MockElement('drawerOverlay'),
    '#logoIcon': new MockElement('logoIcon'),
    '#headerTitle': new MockElement('headerTitle'),
    '#headerSubtitle': new MockElement('headerSubtitle'),
    '#btnBack': new MockElement('btnBack')
};

global.document = {
    title: 'MODiE',
    documentElement: new MockElement('html'),
    querySelector(sel) {
        if (!mockElements[sel]) {
            mockElements[sel] = new MockElement(sel);
        }
        return mockElements[sel];
    },
    querySelectorAll() {
        return [];
    },
    createElement() {
        return new MockElement('div');
    },
    addEventListener() {},
    removeEventListener() {}
};

let popstateListener = null;
global.window = {
    lucide: {
        createIcons() {}
    },
    location: {
        search: '',
        pathname: '/'
    },
    addEventListener(event, callback) {
        if (event === 'popstate') {
            popstateListener = callback;
        }
    }
};

const historyStack = [];
global.history = {
    state: null,
    pushState(state, title, url) {
        this.state = state;
        historyStack.push(state);
    },
    back() {
        if (historyStack.length > 0) {
            historyStack.pop();
            this.state = historyStack[historyStack.length - 1] || null;
            if (popstateListener) {
                popstateListener({ state: this.state });
            }
        }
    }
};

global.localStorage = {
    getItem() { return null; },
    setItem() {}
};

global.getComputedStyle = () => {
    return { lineHeight: '20px' };
};

async function runTests() {
    const appModule = await import('../static/js/app.js');
    const { toggleSettings } = await import('../static/js/ui.js');
    const { toggleOutline } = await import('../static/js/ui-outline.js');

    const ctx = {
        state: { activeFilePath: null, currentTab: 'editor' },
        editor: mockElements['#editor'] || new MockElement('editor'),
        lineNumbers: mockElements['#lineNumbers'] || new MockElement('lineNumbers'),
        preview: mockElements['#preview'] || new MockElement('preview')
    };

    historyStack.length = 0;
    global.history.state = null;

    const settingsDrawer = mockElements['#settingsDrawer'];
    const overlay = mockElements['#drawerOverlay'];

    assert.strictEqual(settingsDrawer.classList.contains('active'), false);
    assert.strictEqual(overlay.classList.contains('active'), false);

    toggleSettings(ctx);

    assert.strictEqual(settingsDrawer.classList.contains('active'), true);
    assert.strictEqual(overlay.classList.contains('active'), true);
    assert.deepStrictEqual(global.history.state, { drawer: 'settings' });

    toggleSettings(ctx);

    assert.strictEqual(settingsDrawer.classList.contains('active'), false);
    assert.strictEqual(overlay.classList.contains('active'), false);
    assert.strictEqual(global.history.state, null);
    assert.strictEqual(ctx.state.currentTab, 'editor');

    const outlineDrawer = mockElements['#outlineDrawer'];
    assert.strictEqual(outlineDrawer.classList.contains('active'), false);

    toggleOutline(ctx);

    assert.strictEqual(outlineDrawer.classList.contains('active'), true);
    assert.strictEqual(overlay.classList.contains('active'), true);
    assert.deepStrictEqual(global.history.state, { drawer: 'outline' });

    toggleOutline(ctx);

    assert.strictEqual(outlineDrawer.classList.contains('active'), false);
    assert.strictEqual(overlay.classList.contains('active'), false);
    assert.strictEqual(global.history.state, null);
    assert.strictEqual(ctx.state.currentTab, 'editor');

    console.log('[PASS] Drawer popstate click-out behavior verified.');
    process.exit(0);
}

runTests().catch(err => {
    console.error(err);
    process.exit(1);
});
