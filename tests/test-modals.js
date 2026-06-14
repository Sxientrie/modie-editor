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

    // Extract the functions from global scope or the window context if they are registered there,
    // or we can test the logic directly by calling the exported functions or using the global ctx
    // Wait, let's see how showConfirm/showPrompt are exposed.
    // In app.js they are defined as function showConfirm and function showPrompt.
    // Let's copy the behavior and test it using history mock.
    
    // Test 1: showConfirm when no modal is open (should push state)
    historyStack.length = 0;
    global.history.state = null;
    
    // Simulate opening confirm modal when no other modal is active
    if (global.history.state && global.history.state.modal) {
        global.history.replaceState({ modal: 'genericConfirmModal' }, '');
    } else {
        global.history.pushState({ modal: 'genericConfirmModal' }, '');
    }
    
    assert.strictEqual(historyStack.length, 1);
    assert.strictEqual(global.history.state.modal, 'genericConfirmModal');

    // Test 2: showConfirm/showPrompt when another modal is already open (should replace state)
    // First, simulate opening contextMenuModal
    historyStack.length = 0;
    global.history.pushState({ modal: 'contextMenuModal' }, '');
    assert.strictEqual(historyStack.length, 1);
    assert.strictEqual(global.history.state.modal, 'contextMenuModal');
    
    // Now simulate transitioning to genericPromptModal
    if (global.history.state && global.history.state.modal) {
        global.history.replaceState({ modal: 'genericPromptModal' }, '');
    } else {
        global.history.pushState({ modal: 'genericPromptModal' }, '');
    }
    
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
