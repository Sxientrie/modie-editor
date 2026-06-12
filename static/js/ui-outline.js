export function toggleOutline(ctx) {
    const drawer = document.querySelector('#outlineDrawer');
    const overlay = document.querySelector('#drawerOverlay');
    if (!drawer || !overlay) return;
    
    const active = drawer.classList.toggle('active');
    overlay.classList.toggle('active', active);
    
    if (active) {
        populateOutline(ctx);
        history.pushState({ drawer: 'outline' }, '');
    } else {
        if (history.state && history.state.drawer === 'outline') {
            history.back();
        }
    }
}

export function populateOutline(ctx) {
    const container = document.querySelector('#outlineContent');
    if (!container) return;
    const md = ctx.editor.value;
    const lines = md.split('\n');
    container.innerHTML = '';
    let inCode = false;
    let headingCounter = 0;
    let charIndex = 0;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim().startsWith('```')) {
            inCode = !inCode;
            charIndex += line.length + 1;
            continue;
        }
        if (inCode) {
            charIndex += line.length + 1;
            continue;
        }
        const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
        if (headerMatch) {
            const level = headerMatch[1].length;
            const title = headerMatch[2].trim();
            const el = document.createElement('div');
            el.className = `outline-item h${level}`;
            el.textContent = title;
            el.dataset.charIndex = charIndex;
            const targetHeadingIndex = headingCounter;
            el.addEventListener('click', () => {
                if (ctx.state.currentTab === 'edit') {
                    const foundCharIndex = parseInt(el.dataset.charIndex, 10);
                    ctx.editor.focus();
                    ctx.editor.setSelectionRange(foundCharIndex, foundCharIndex);
                    const currentMd = ctx.editor.value;
                    const linesBefore = currentMd.substring(0, foundCharIndex).split('\n').length;
                    const lh = parseFloat(getComputedStyle(ctx.editor).lineHeight);
                    ctx.editor.scrollTop = (linesBefore - 3) * lh;
                } else if (ctx.state.currentTab === 'preview') {
                    const headingEl = document.querySelector(`#preview-heading-${targetHeadingIndex}`);
                    if (headingEl) {
                        headingEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                }
                toggleOutline(ctx);
            });
            container.appendChild(el);
            headingCounter++;
        }
        charIndex += line.length + 1;
    }
    if (container.children.length === 0) {
        container.innerHTML = `<div class="empty-state" style="padding: 20px 0;"><p style="color:var(--text-muted);font-size:12px;">No headings found</p></div>`;
    } else {
        updateActiveHeading(ctx);
    }
}

export function updateActiveHeading(ctx) {
    const container = document.querySelector('#outlineContent');
    if (!container) return;
    const pos = ctx.editor.selectionStart;
    const items = container.querySelectorAll('.outline-item');
    let activeItem = null;
    let maxIndex = -1;
    items.forEach(item => {
        item.classList.remove('active');
        const idx = parseInt(item.dataset.charIndex, 10);
        if (pos >= idx && idx > maxIndex) {
            maxIndex = idx;
            activeItem = item;
        }
    });
    if (activeItem) {
        activeItem.classList.add('active');
    }
}

export function setupOutline(ctx) {
    const btnOutline = document.querySelector('#btnOutline');
    const btnOutlineClose = document.querySelector('#btnOutlineClose');
    if (btnOutline) {
        btnOutline.addEventListener('click', () => toggleOutline(ctx));
    }
    if (btnOutlineClose) {
        btnOutlineClose.addEventListener('click', () => toggleOutline(ctx));
    }
}
