import { marked } from './marked.esm.js';
import { escapeHtml } from './utils.js';

let headingCounter = 0;

const renderer = {
    heading(token) {
        const text = this.parser.parseInline(token.tokens);
        return `<h${token.depth} id="preview-heading-${headingCounter++}">${text}</h${token.depth}>`;
    },
    link(token) {
        const cleanUrl = token.href.trim();
        if (/^(javascript|data|vbscript|file):/i.test(cleanUrl)) {
            return `<span>${token.text}</span>`;
        }
        return `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer">${token.text}</a>`;
    },
    html(token) {
        return escapeHtml(token.text);
    }
};

marked.use({ renderer });

export function renderMarkdown(md) {
    headingCounter = 0;
    return marked.parse(md);
}