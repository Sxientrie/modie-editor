async function runTests() {
    const { diffLines } = await import('../static/js/utils.js');
    const assert = (await import('assert')).default || await import('assert');

    let passed = 0;
    let failed = 0;

    function test(name, fn) {
        try {
            fn();
            passed++;
            console.log(`[PASS] ${name}`);
        } catch (e) {
            failed++;
            console.error(`[FAIL] ${name}:`, e.message);
        }
    }

    test('Identical text', () => {
        const res = diffLines("hello\nworld", "hello\nworld");
        assert.deepStrictEqual(res, [
            { type: 'unchanged', text: 'hello' },
            { type: 'unchanged', text: 'world' }
        ]);
    });

    test('Additions only', () => {
        const res = diffLines("hello", "hello\nworld");
        assert.deepStrictEqual(res, [
            { type: 'unchanged', text: 'hello' },
            { type: 'added', text: 'world' }
        ]);
    });

    test('Deletions only', () => {
        const res = diffLines("hello\nworld", "hello");
        assert.deepStrictEqual(res, [
            { type: 'unchanged', text: 'hello' },
            { type: 'deleted', text: 'world' }
        ]);
    });

    test('Modification in middle', () => {
        const res = diffLines("one\ntwo\nthree", "one\nchanged\nthree");
        assert.deepStrictEqual(res, [
            { type: 'unchanged', text: 'one' },
            { type: 'deleted', text: 'two' },
            { type: 'added', text: 'changed' },
            { type: 'unchanged', text: 'three' }
        ]);
    });

    test('Empty strings', () => {
        const res = diffLines("", "");
        assert.deepStrictEqual(res, [{ type: 'unchanged', text: '' }]);
    });

    test('Highly dissimilar inputs', () => {
        const res = diffLines("a\nb\nc", "d\ne\nf");
        assert.deepStrictEqual(res, [
            { type: 'deleted', text: 'a' },
            { type: 'deleted', text: 'b' },
            { type: 'deleted', text: 'c' },
            { type: 'added', text: 'd' },
            { type: 'added', text: 'e' },
            { type: 'added', text: 'f' }
        ]);
    });

    console.log(`\nDiff tests finished: ${passed} passed, ${failed} failed.`);
    if (failed > 0) {
        process.exit(1);
    }
}

runTests().catch(e => {
    console.error(e);
    process.exit(1);
});
