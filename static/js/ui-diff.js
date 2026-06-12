import { diffLines } from './utils.js';

export function showDiffModal(ctx, path, localText, serverText) {
    return new Promise((resolve) => {
        const modal = document.querySelector('#diffModal');
        const container = document.querySelector('#diffViewContainer');
        const btnLocal = document.querySelector('#btnDiffAcceptLocal');
        const btnServer = document.querySelector('#btnDiffAcceptServer');
        const btnCancel = document.querySelector('#btnDiffCancel');
        if (!modal || !container || !btnLocal || !btnServer || !btnCancel) {
            resolve('cancel');
            return;
        }
        container.innerHTML = '';
        const diffs = diffLines(serverText, localText);
        const frag = document.createDocumentFragment();
        diffs.forEach(d => {
            const div = document.createElement('div');
            div.className = `diff-line ${d.type}`;
            div.textContent = (d.type === 'added' ? '+ ' : d.type === 'deleted' ? '- ' : '  ') + d.text;
            frag.appendChild(div);
        });
        container.appendChild(frag);
        modal.classList.add('active');
        history.pushState({ modal: 'diffModal' }, '');
        function cleanup(result) {
            modal.classList.remove('active');
            btnLocal.removeEventListener('click', onLocal);
            btnServer.removeEventListener('click', onServer);
            btnCancel.removeEventListener('click', onCancel);
            modal.removeEventListener('click', onOverlay);
            container.innerHTML = '';
            if (history.state && history.state.modal === 'diffModal') history.back();
            resolve(result);
        }
        function onLocal() { cleanup('local'); }
        function onServer() { cleanup('server'); }
        function onCancel() { cleanup('cancel'); }
        const onOverlay = (e) => { if (e.target === modal) cleanup('cancel'); };
        btnLocal.addEventListener('click', onLocal);
        btnServer.addEventListener('click', onServer);
        btnCancel.addEventListener('click', onCancel);
        modal.addEventListener('click', onOverlay);
    });
}
