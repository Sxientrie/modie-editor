import assert from 'assert';

global.window = {
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

global.document = {
    title: 'MODiE'
};

async function runTests() {
    const urlParams = new URLSearchParams(global.window.location.search);
    assert.ok(urlParams.has('token'));
    assert.strictEqual(urlParams.get('token'), 'test_session_token_123');
    
    if (urlParams.has('token')) {
        global.localStorage.setItem('editor_token', urlParams.get('token'));
        global.window.history.replaceState({}, global.document.title, global.window.location.pathname);
    }
    
    assert.strictEqual(global.localStorage.getItem('editor_token'), 'test_session_token_123');
    assert.ok(global.window.history.called);
    assert.strictEqual(global.window.history.url, '/index.html');
    
    console.log('[PASS] Token bootstrap and URL parameter stripping verified.');
}

runTests().catch(err => {
    console.error(err);
    process.exit(1);
});
