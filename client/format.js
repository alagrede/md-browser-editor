// Formatting commands, as plain CodeMirror commands: (view) => boolean.
//
// They work on the markdown source, which is the only state there is — there is
// no separate rich model to keep in sync. Each one is written to be a toggle:
// applying bold to text that is already bold takes it off, because a formatting
// command that only ever adds is a command you have to undo by hand.

const LINE_PREFIX = /^(\s*)(#{1,6}\s+|>\s+|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)?/;

/** The lines a selection touches, whole. */
function selectedLines(state) {
    const { from, to } = state.selection.main;
    const first = state.doc.lineAt(from).number;
    const last = state.doc.lineAt(to).number;
    const lines = [];
    for (let number = first; number <= last; number++) lines.push(state.doc.line(number));
    return lines;
}

/**
 * Wraps the selection in `marker`, or unwraps it when it is already wrapped.
 * With no selection it inserts the pair and puts the caret between them, so
 * ⌘B then typing does what everyone expects.
 */
export function toggleWrap(marker, markerEnd = marker) {
    return view => {
        const { state } = view;
        const { from, to, empty } = state.selection.main;

        if (empty) {
            view.dispatch({
                changes: { from, insert: marker + markerEnd },
                selection: { anchor: from + marker.length },
                userEvent: 'input.format',
            });
            return true;
        }

        const selected = state.sliceDoc(from, to);

        // Already wrapped, inside the selection: "**bold**" -> "bold"
        if (
            selected.length >= marker.length + markerEnd.length &&
            selected.startsWith(marker) &&
            selected.endsWith(markerEnd)
        ) {
            const inner = selected.slice(marker.length, selected.length - markerEnd.length);
            view.dispatch({
                changes: { from, to, insert: inner },
                selection: { anchor: from, head: from + inner.length },
                userEvent: 'input.format',
            });
            return true;
        }

        // Already wrapped, just outside it: "**|bold|**" -> "bold"
        const before = state.sliceDoc(Math.max(0, from - marker.length), from);
        const after = state.sliceDoc(to, Math.min(state.doc.length, to + markerEnd.length));
        if (before === marker && after === markerEnd) {
            view.dispatch({
                changes: { from: from - marker.length, to: to + markerEnd.length, insert: selected },
                selection: { anchor: from - marker.length, head: from - marker.length + selected.length },
                userEvent: 'input.format',
            });
            return true;
        }

        view.dispatch({
            changes: [
                { from, insert: marker },
                { from: to, insert: markerEnd },
            ],
            selection: { anchor: from + marker.length, head: to + marker.length },
            userEvent: 'input.format',
        });
        return true;
    };
}

/**
 * Puts `prefix` at the head of every selected line, or takes it off when every
 * one already has it. `prefix` is a function of the line's rank, so an ordered
 * list can number itself.
 */
export function toggleLinePrefix(prefixFor) {
    return view => {
        const { state } = view;
        const lines = selectedLines(state);
        const changes = [];

        const stripped = lines.map(line => {
            const match = LINE_PREFIX.exec(line.text);
            return { line, indent: match[1] ?? '', existing: match[2] ?? '', rest: line.text.slice(match[0].length) };
        });

        // Every line already carries exactly this prefix: the command removes it.
        const removing = stripped.every(
            (entry, index) => entry.existing === prefixFor(index + 1) && entry.existing.length > 0
        );

        stripped.forEach((entry, index) => {
            const insert = entry.indent + (removing ? '' : prefixFor(index + 1)) + entry.rest;
            if (insert !== entry.line.text) {
                changes.push({ from: entry.line.from, to: entry.line.to, insert });
            }
        });

        if (!changes.length) return false;
        view.dispatch({ changes, userEvent: 'input.format' });
        return true;
    };
}

/** Everything a line prefix can be, gone. */
export const clearBlockFormatting = toggleLinePrefix(() => '');

/** Inline markers removed from the selection, leaving the words. */
export function clearFormatting(view) {
    const { state } = view;
    const { from, to, empty } = state.selection.main;
    if (empty) return false;

    const cleaned = state
        .sliceDoc(from, to)
        .replace(/(\*\*|__|~~|==|\*|_|`)/g, '')
        .replace(/^\s*(#{1,6}\s+|>\s+|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/gm, '');

    view.dispatch({
        changes: { from, to, insert: cleaned },
        selection: { anchor: from, head: from + cleaned.length },
        userEvent: 'input.format',
    });
    return true;
}

/** A heading of that level, or a plain paragraph when it is one already. */
export function setHeading(level) {
    return toggleLinePrefix(() => '#'.repeat(level) + ' ');
}

export const toggleQuote = toggleLinePrefix(() => '> ');
export const toggleBullet = toggleLinePrefix(() => '- ');
export const toggleTask = toggleLinePrefix(() => '- [ ] ');
export const toggleOrdered = toggleLinePrefix(rank => `${rank}. `);

/**
 * Inserts a block on its own lines below the caret, leaving a blank line where
 * markdown needs one.
 */
export function insertBlock(text, { selectFrom = null } = {}) {
    return view => {
        const { state } = view;
        const line = state.doc.lineAt(state.selection.main.head);
        // On a blank line the block goes there; otherwise it goes after the
        // line the caret is on.
        const pos = line.text.trim() === '' ? line.from : line.to;

        // Markdown needs a blank line before a block, and the caret's own blank
        // line is that separator — consuming it glued the block to the
        // paragraph above, which then parsed as one thing.
        const before = state.sliceDoc(Math.max(0, pos - 2), pos);
        const prefix = pos === 0 || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
        const suffix = pos === state.doc.length ? '\n' : '';

        const start = pos + prefix.length;
        const anchor = start + (selectFrom ? text.indexOf(selectFrom) : text.length);
        view.dispatch({
            changes: { from: pos, insert: prefix + text + suffix },
            selection: selectFrom ? { anchor, head: anchor + selectFrom.length } : { anchor },
            userEvent: 'input.format',
            scrollIntoView: true,
        });
        return true;
    };
}

export const insertTable = insertBlock('| Column | Column |\n| --- | --- |\n|  |  |', { selectFrom: 'Column' });
export const insertCodeBlock = insertBlock('```\n\n```', { selectFrom: '```\n\n```' });
export const insertDivider = insertBlock('---');

/**
 * A link around the selection — or an empty one with the caret in the target,
 * which is where you are about to type or paste.
 */
export function insertLink(asImage = false) {
    return view => {
        const { state } = view;
        const { from, to, empty } = state.selection.main;
        const label = empty ? '' : state.sliceDoc(from, to);
        const bang = asImage ? '!' : '';
        const insert = `${bang}[${label}]()`;
        const caret = from + bang.length + 1 + label.length + 2;

        view.dispatch({
            changes: { from, to, insert },
            selection: { anchor: caret },
            userEvent: 'input.format',
        });
        return true;
    };
}

export const toggleBold = toggleWrap('**');
export const toggleItalic = toggleWrap('*');
export const toggleCode = toggleWrap('`');
export const toggleStrikethrough = toggleWrap('~~');
