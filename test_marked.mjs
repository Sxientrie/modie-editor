import { marked } from './static/js/marked.esm.js';

const escapeHtml = (text) => text.replace(/</g, '&lt;').replace(/>/g, '&gt;');

marked.use({
  renderer: {
    html(token) {
      return escapeHtml(token.text);
    }
  }
});

console.log(marked.parse('<script>alert("xss")</script>'));
console.log(marked.parse('Hello <script>alert("xss")</script> World'));
