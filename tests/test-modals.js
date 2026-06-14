import assert from 'assert';

// Mock the DOM and browser environment
const dummyElement = {
    addEventListener() {},
    removeEventListener() {},
    classList: {
        add() {},
        remove() {},
        contains() { return false; },
        toggle() {}
    },
    style: {},
    appendChild() {},
    querySelectorAll() { return []; },
    value: '',
    focus() {},
    setAttribute() {},
    remove() {}
};

global.document = {
    title: 'MODiE',
    documentElement: dummyElement,
    querySelector(sel) {
        return dummyElement;
    },
    querySelectorAll(sel) {
        return [];
    },
    createElement() {
        return dummyElement;
    },
    addEventListener() {},
    removeEventListener() {}
};

global.localStorage = {
    store: {},
    getItem(key) { return this.store[key] || null; },
    setItem(key, val) { this.store[key] = val; },
    removeItem(key) { delete this.store[key]; },
    key() { return null; },
    length: 0
};

// Mock history stack
const historyStack = [];
global.history = {
    state: null,
    pushState(state, title, url) {
        this.state = state;
        historyStack.push(state);
    },
    replaceState(state, title, url) {
        this.state = state;
        if (historyStack.length > 0) {
            historyStack[historyStack.length - 1] = state;
        } else {
            historyStack.push(state);
        }
    },
    back() {
        historyStack.pop();
        this.state = historyStack[historyStack.length - 1] || null;
    }
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

Object.defineProperty(global, 'navigator', {
    value: {
        serviceWorker: {
            register() {},
            addEventListener() {}
        }
    },
    configurable: true,
    writable: true
});
global.getComputedStyle = function(el) {
    return { lineHeight: '20px' };
};
async function runTests() {
    // Import app.js dynamically so it executes within our mocked environment
    const appModule = await import('../static/js/app.js');

    // Test 1: showConfirm when no modal is open (should push state)
    historyStack.length = 0;
    global.history.state = null;
    
    appModule.showConfirm('Confirm Title', 'Confirm Message');
    
    assert.strictEqual(historyStack.length, 1);
    assert.strictEqual(global.history.state.modal, 'genericConfirmModal');

    // Test 2: showConfirm/showPrompt when another modal is already open (should replace state)
    // First, simulate opening contextMenuModal
    historyStack.length = 0;
    global.history.pushState({ modal: 'contextMenuModal' }, '');
    assert.strictEqual(historyStack.length, 1);
    assert.strictEqual(global.history.state.modal, 'contextMenuModal');
    
    // Call showPrompt, which should replace the history state rather than push
    appModule.showPrompt('Prompt Title', 'Prompt Message');
    
    // The history stack length should STILL be 1 because it replaced the state instead of pushing!
    assert.strictEqual(historyStack.length, 1);
    assert.strictEqual(global.history.state.modal, 'genericPromptModal');

    console.log('[PASS] Modal history transition and replaceState behavior verified.');
    process.exit(0);
}

runTests().catch(err => {
    console.error(err);
    process.exit(1);
});
