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
        this.listeners = {};
    }
    addEventListener(event, callback) {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(callback);
    }
    removeEventListener() {}
    appendChild(el) {
        this.children.push(el);
    }
    querySelectorAll() { return []; }
    focus() {}
    setAttribute() {}
    remove() {}
    setSelectionRange() {}
    click() {
        if (this.listeners['click']) {
            this.listeners['click'].forEach(fn => fn());
        }
    }
}

const mockElements = {
    '#outlineDrawer': new MockElement('outlineDrawer'),
    '#settingsDrawer': new MockElement('settingsDrawer'),
    '#drawerOverlay': new MockElement('drawerOverlay'),
    '#logoIcon': new MockElement('logoIcon'),
    '#headerTitle': new MockElement('headerTitle'),
    '#headerSubtitle': new MockElement('headerSubtitle'),
    '#btnBack': new MockElement('btnBack'),
    '#fileTabs': new MockElement('fileTabs'),
    '#editor': new MockElement('editor'),
    '#lineNumbers': new MockElement('lineNumbers'),
    '#preview': new MockElement('preview')
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

global.window = {
    lucide: {
        createIcons() {}
    },
    location: {
        search: '',
        pathname: '/'
    },
    addEventListener() {}
};

const historyStack = [];
global.history = {
    state: null,
    pushState(state, title, url) {
        this.state = state;
        historyStack.push(state);
    },
    replaceState(state, title, url) {
        this.state = state;
    }
};

global.localStorage = {
    getItem() { return null; },
    setItem() {},
    removeItem() {}
};

const mockContentData = {
    'fileA.md': { content: 'Content of A', modified: '2026-06-14T00:00:00Z' },
    'fileB.md': { content: 'Content of B', modified: '2026-06-14T00:00:00Z' }
};

global.getComputedStyle = () => {
    return { lineHeight: '20px' };
};

global.AbortController = class AbortController {
    constructor() {
        this.signal = {};
    }
    abort() {}
};

global.fetch = (url, options = {}) => {
    const parsedUrl = new URL(url, 'http://localhost');
    if (parsedUrl.pathname === '/api/content') {
        const path = parsedUrl.searchParams.get('path');
        const item = mockContentData[path];
        if (item) {
            return Promise.resolve({
                ok: true,
                status: 200,
                json() {
                    return Promise.resolve({
                        content: item.content,
                        modified: item.modified,
                        size: item.content.length
                    });
                }
            });
        }
    } else if (parsedUrl.pathname === '/api/create' && options.method === 'POST') {
        const body = JSON.parse(options.body);
        mockContentData[body.name] = { content: '', modified: '2026-06-14T00:00:00Z' };
        return Promise.resolve({
            ok: true,
            status: 200,
            json() {
                return Promise.resolve({ ok: true });
            }
        });
    }
    return Promise.reject(new Error('Not found'));
};

async function runTests() {
    const appModule = await import('../static/js/app.js');
    const { openFile, switchToFile, closeTab } = await import('../static/js/tabs.js');

    const ctx = appModule.ctx;
    const state = appModule.state;

    ctx.showPrompt = (title, message) => {
        return Promise.resolve('fileC.md');
    };

    assert.strictEqual(state.activeFilePath, null);
    assert.strictEqual(Object.keys(state.openFiles).length, 0);

    await openFile('fileA.md');

    assert.strictEqual(state.activeFilePath, 'fileA.md');
    assert.strictEqual(Object.keys(state.openFiles).length, 1);
    assert.strictEqual(state.openFiles['fileA.md'].content, 'Content of A');

    const btnBack = mockElements['#btnBack'];
    btnBack.click();

    assert.strictEqual(state.activeFilePath, null);
    assert.strictEqual(Object.keys(state.openFiles).length, 1);
    assert.strictEqual(state.currentTab, 'browser');

    await openFile('fileB.md');

    assert.strictEqual(state.activeFilePath, 'fileB.md');
    assert.strictEqual(Object.keys(state.openFiles).length, 2);
    assert.strictEqual(state.openFiles['fileA.md'].content, 'Content of A');
    assert.strictEqual(state.openFiles['fileB.md'].content, 'Content of B');

    const btnNewTab = mockElements['#btnNewTab'];
    assert.ok(btnNewTab);
    btnNewTab.click();
    await new Promise(resolve => setTimeout(resolve, 50));

    assert.strictEqual(state.activeFilePath, 'fileC.md');
    assert.strictEqual(Object.keys(state.openFiles).length, 3);

    switchToFile('fileA.md');
    assert.strictEqual(state.activeFilePath, 'fileA.md');

    await closeTab('fileA.md', true);
    assert.strictEqual(state.activeFilePath, 'fileC.md');
    assert.strictEqual(Object.keys(state.openFiles).length, 2);

    await closeTab('fileB.md', true);
    assert.strictEqual(state.activeFilePath, 'fileC.md');
    assert.strictEqual(Object.keys(state.openFiles).length, 1);

    await closeTab('fileC.md', true);
    assert.strictEqual(state.activeFilePath, null);
    assert.strictEqual(Object.keys(state.openFiles).length, 0);
    assert.strictEqual(state.currentTab, 'browser');

    console.log('[PASS] Multiple edit text open behavior verified.');
    process.exit(0);
}

runTests().catch(err => {
    console.error(err);
    process.exit(1);
});
