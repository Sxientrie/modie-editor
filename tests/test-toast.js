import assert from 'assert';

// Mock the DOM environment required by ui.js and toast
const mockContainer = {
    appended: [],
    appendChild(el) {
        this.appended.push(el);
    },
    querySelectorAll(query) {
        return this.appended;
    }
};

global.document = {
    toastContainer: mockContainer,
    querySelector(sel) {
        if (sel === '#toastContainer') {
            return mockContainer;
        }
        return null;
    },
    createElement(tag) {
        if (tag === 'div') {
            const el = {
                className: '',
                innerHTML: '',
                remove() {
                    const idx = mockContainer.appended.indexOf(this);
                    if (idx > -1) {
                        mockContainer.appended.splice(idx, 1);
                    }
                }
            };
            el.classList = {
                contains(c) {
                    return el.className.split(' ').includes(c);
                }
            };
            return el;
        }
        return {};
    }
};

global.localStorage = {
    getItem() { return null; },
    setItem() {}
};

async function runTests() {
    const { toast } = await import('../static/js/ui.js');

    // Test 1: Single toast should render successfully
    mockContainer.appended = [];
    toast('Hello World', 'success');
    assert.strictEqual(mockContainer.appended.length, 1);
    assert.ok(mockContainer.appended[0].className.includes('success'));
    assert.ok(mockContainer.appended[0].innerHTML.includes('Hello World'));

    // Test 2: Double identical toasts within 500ms should deduplicate
    mockContainer.appended = [];
    toast('Duplicate Test', 'info');
    toast('Duplicate Test', 'info');
    assert.strictEqual(mockContainer.appended.length, 1);

    // Test 3: Toasts with different types should not deduplicate
    mockContainer.appended = [];
    toast('Type Test', 'success');
    toast('Type Test', 'error');
    assert.strictEqual(mockContainer.appended.length, 2);

    // Test 4: Toasts with different messages should not deduplicate
    mockContainer.appended = [];
    toast('Message A', 'info');
    toast('Message B', 'info');
    assert.strictEqual(mockContainer.appended.length, 2);

    console.log('[PASS] Toast deduplication logic verified.');
}

runTests().catch(err => {
    console.error(err);
    process.exit(1);
});
