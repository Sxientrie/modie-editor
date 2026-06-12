async function runTests() {
    const { renderMarkdown } = await import('./static/js/markdown.js');

    let passed = 0;
    let failed = 0;
    let current_section = '';

    function section(name) {
        current_section = name;
    }

    function t(label, input, expected) {
        const actual = renderMarkdown(input).trim();
        if (actual === expected.trim()) {
            passed++;
        } else {
            failed++;
            console.error(`FAIL [${current_section}] ${label}`);
            console.error(`  input:    ${JSON.stringify(input)}`);
            console.error(`  expected: ${JSON.stringify(expected)}`);
            console.error(`  actual:   ${JSON.stringify(actual)}`);
        }
    }

    function includes(label, input, fragment) {
        const actual = renderMarkdown(input);
        if (actual.includes(fragment)) {
            passed++;
        } else {
            failed++;
            console.error(`FAIL [${current_section}] ${label}`);
            console.error(`  input:    ${JSON.stringify(input)}`);
            console.error(`  expected to include: ${JSON.stringify(fragment)}`);
            console.error(`  actual:              ${JSON.stringify(actual)}`);
        }
    }

    section('Headings');
    t('h1', '# Hello', '<h1 id="preview-heading-0">Hello</h1>');
    t('h2', '## Sub', '<h2 id="preview-heading-0">Sub</h2>');
    t('h3', '### Deep', '<h3 id="preview-heading-0">Deep</h3>');
    t('h4', '#### Deeper', '<h4 id="preview-heading-0">Deeper</h4>');
    t('h5', '##### Five', '<h5 id="preview-heading-0">Five</h5>');
    t('h6', '###### Six', '<h6 id="preview-heading-0">Six</h6>');
    t('heading counter increments', '# A\n# B',
        '<h1 id="preview-heading-0">A</h1><h1 id="preview-heading-1">B</h1>');
    t('heading with inline bold', '# **Bold** title',
        '<h1 id="preview-heading-0"><strong>Bold</strong> title</h1>');
    t('no heading without space', '#NoSpace', '<p>#NoSpace</p>');
    t('7 hashes is not a heading', '####### Seven', '<p>####### Seven</p>');

    section('Paragraphs');
    t('plain paragraph', 'Hello world', '<p>Hello world</p>');
    t('two paragraphs separated by blank line', 'One\n\nTwo', '<p>One</p>\n<p>Two</p>');
    t('HTML entities escaped', '<script>alert("xss")</script>',
        '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');

    section('Inline: Bold, Italic, Bold-Italic');
    t('bold', '**strong**', '<p><strong>strong</strong></p>');
    t('italic', '*em*', '<p><em>em</em></p>');
    t('bold-italic', '***both***', '<p><em><strong>both</strong></em></p>');
    t('bold inside text', 'a **b** c', '<p>a <strong>b</strong> c</p>');
    t('italic inside text', 'a *b* c', '<p>a <em>b</em> c</p>');
    t('mixed bold and italic', '**bold** and *italic*',
        '<p><strong>bold</strong> and <em>italic</em></p>');

    section('Inline: Code');
    t('inline code', '`code`', '<p><code>code</code></p>');
    t('inline code preserves HTML', '`<div>`', '<p><code>&lt;div&gt;</code></p>');
    t('inline code in sentence', 'run `npm install` now',
        '<p>run <code>npm install</code> now</p>');

    section('Inline: Strikethrough');
    t('strikethrough', '~~deleted~~', '<p><del>deleted</del></p>');
    t('strikethrough in sentence', 'was ~~wrong~~ right',
        '<p>was <del>wrong</del> right</p>');

    section('Inline: Links');
    t('basic link', '[click](https://example.com)',
        '<p><a href="https://example.com" target="_blank" rel="noopener noreferrer">click</a></p>');
    t('javascript: link sanitized', '[xss](javascript:alert(1))',
        '<p><span>xss</span></p>');
    t('data: link sanitized', '[xss](data:text/html,<h1>hi</h1>)',
        '<p><span>xss</span></p>');
    t('vbscript: link sanitized', '[xss](vbscript:msgbox)',
        '<p><span>xss</span></p>');

    console.log(`\nTests finished: ${passed} passed, ${failed} failed.`);
    if (failed > 0) {
        process.exit(1);
    }
}

runTests().catch(e => {
    console.error(e);
    process.exit(1);
});