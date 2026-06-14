import assert from 'assert';

global.window = {
    lucide: {
        createIcons() {}
    },
    location: {
        search: '?token=test_session_token_123&other=param',
        pathname: '/index.html'
    },
    history: {
        replaceState(state, title, url) {
            this.called = true;
            this.state = state;
            this.title = title;
            this.url = url;
        }
    }
};

global.localStorage = {
    store: {},
    setItem(key, val) {
        this.store[key] = val;
    },
    getItem(key) {
        return this.store[key] || null;
    }
};

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

global.window.addEventListener = () => {};

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
    const { bootstrapToken } = await import('../static/js/app.js');
    
    assert.strictEqual(global.localStorage.getItem('editor_token'), 'test_session_token_123');
    assert.ok(global.window.history.called);
    assert.strictEqual(global.window.history.url, '/index.html');
    
    console.log('[PASS] Token bootstrap and URL parameter stripping verified.');
    process.exit(0);
}

runTests().catch(err => {
    console.error(err);
    process.exit(1);
});
