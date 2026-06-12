export class UndoStack {
    constructor(maxSize = 50) {
        this.maxSize = maxSize;
        this.entries = [];
        this.pointer = -1;
    }

    push(content, selectionStart, selectionEnd) {
        if (this.pointer >= 0 && this.entries[this.pointer].content === content) {
            return;
        }

        const now = Date.now();
        if (this.pointer >= 0) {
            const current = this.entries[this.pointer];
            if (now - current.timestamp < 500 && Math.abs(content.length - current.content.length) < 5) {
                current.content = content;
                current.selectionStart = selectionStart;
                current.selectionEnd = selectionEnd;
                current.timestamp = now;
                return;
            }
        }

        this.entries = this.entries.slice(0, this.pointer + 1);
        this.entries.push({ content, selectionStart, selectionEnd, timestamp: now });
        if (this.entries.length > this.maxSize) {
            this.entries.shift();
        } else {
            this.pointer++;
        }
    }

    undo() {
        if (this.pointer > 0) {
            this.pointer--;
            return this.entries[this.pointer];
        }
        return null;
    }

    redo() {
        if (this.pointer < this.entries.length - 1) {
            this.pointer++;
            return this.entries[this.pointer];
        }
        return null;
    }

    canUndo() {
        return this.pointer > 0;
    }

    canRedo() {
        return this.pointer < this.entries.length - 1;
    }

    current() {
        return this.pointer >= 0 ? this.entries[this.pointer] : null;
    }

    reset(content, selectionStart, selectionEnd) {
        this.entries = [{ content, selectionStart, selectionEnd, timestamp: Date.now() }];
        this.pointer = 0;
    }
}

const undoStacks = new Map();

export function getOrCreateStack(path, initialContent) {
    if (!undoStacks.has(path)) {
        const stack = new UndoStack();
        stack.reset(initialContent || '', 0, 0);
        undoStacks.set(path, stack);
    }
    return undoStacks.get(path);
}

export function removeStack(path) {
    undoStacks.delete(path);
}

export function pushState(path, content, selectionStart, selectionEnd) {
    const stack = getOrCreateStack(path, content);
    stack.push(content, selectionStart, selectionEnd);
}

export function undo(path) {
    const stack = undoStacks.get(path);
    return stack ? stack.undo() : null;
}

export function redo(path) {
    const stack = undoStacks.get(path);
    return stack ? stack.redo() : null;
}
