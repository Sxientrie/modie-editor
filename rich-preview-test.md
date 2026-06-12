# Markdown Rendering Showcase

This document serves as a comprehensive stress test for the newly integrated `marked.js` parser and our dynamic CSS typography scaling. 

---

## 1. Typographic Hierarchy

If the `em` scaling is working correctly, the following headings should scale proportionally without breaking the layout when you adjust the global font size.

# Heading Level 1
## Heading Level 2
### Heading Level 3
#### Heading Level 4
##### Heading Level 5
###### Heading Level 6

---

## 2. Inline Formatting

Normal text mixed with **bold text**, *italic text*, and ***bold italic text***. We also have ~~strikethrough text~~ for things that are no longer true.

Here is the inline code test. The `Array.prototype.map()` function should now visually align with the baseline of this surrounding paragraph instead of looking obnoxiously large.

---

## 3. Blockquotes

> This is a standard blockquote. It should have a nice border on the left and a slightly muted text color.
> 
> > This is a nested blockquote. The old regex parser probably would have butchered this completely. Let's see how `marked.js` handles it.

---

## 4. Lists & Nesting

### Unordered List
*   Item 1
*   Item 2
    *   Nested Item 2.1
    *   Nested Item 2.2
        *   Deeply Nested Item 2.2.1
*   Item 3

### Ordered List
1.  First step
2.  Second step
    1.  Sub-step 2.1
    2.  Sub-step 2.2
3.  Third step

---

## 5. Code Blocks

Here is a standard fenced code block demonstrating a Python snippet:

```python
import os
import sys

def atomic_write(target_path: str, content: str) -> bool:
    """Writes data safely to prevent corruption."""
    temp_file = f"{target_path}.tmp"
    with open(temp_file, 'w') as f:
        f.write(content)
        os.fsync(f.fileno())
    os.replace(temp_file, target_path)
    return True
```

And here is a JavaScript snippet:

```javascript
// This demonstrates syntax highlighting if we ever add a highlighter plugin
async function fetchPreview() {
    const response = await fetch('/api/preview');
    const data = await response.json();
    return data.html;
}
```

---

## 6. Tables

| Feature | Old Custom Parser | Marked.js | Status |
| :--- | :--- | :--- | :--- |
| **Speed** | Fast | Very Fast | 🟢 Improved |
| **Accuracy** | Terrible | Perfect | 🟢 Improved |
| **Nested Lists** | Broke frequently | Handled perfectly | 🟢 Improved |
| **Offline Support** | Yes (No deps) | Yes (Local ESM bundle) | 🟢 Maintained |

---

## 7. Links and Images

Here is a [link to the official Marked.js documentation](https://marked.js.org/).

*(Image rendering test omitted as we are entirely offline, but the tag syntax `![alt](url)` is supported).*
