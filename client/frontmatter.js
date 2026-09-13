// The `---` block at the top, rendered as a Properties panel — and out of the
// markdown parser's way.
//
// Left alone, a frontmatter is not just unstyled: `title: Guide` followed by
// `---` is a setext heading, so the document opens with a giant title made of
// its own metadata. The block widget below replaces it when the caret is
// outside, and steps aside (raw YAML) when the caret is inside, so it stays
// editable with no separate form to keep in sync.
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import { StateField } from '@codemirror/state';
import { findFrontmatter, parseFrontmatter } from '../src/frontmatter.mjs';

function renderProperties(body) {
    const wrap = document.createElement('div');
    wrap.className = 'cm-frontmatter';

    const heading = document.createElement('div');
    heading.className = 'cm-frontmatter-head';
    heading.textContent = 'Properties';
    wrap.appendChild(heading);

    const spacer = () => {
        const element = document.createElement('div');
        element.className = 'cm-frontmatter-spacer';
        return element;
    };

    const properties = parseFrontmatter(body);
    if (!properties.length) {
        const empty = document.createElement('div');
        empty.className = 'cm-frontmatter-empty';
        empty.textContent = body.trim() ? body.trim() : 'No properties';
        wrap.appendChild(empty);
        wrap.appendChild(spacer());
        return wrap;
    }

    const table = document.createElement('table');
    const tbody = document.createElement('tbody');

    for (const property of properties) {
        const row = document.createElement('tr');
        const key = document.createElement('th');
        key.textContent = property.key;
        const value = document.createElement('td');

        if (Array.isArray(property.value)) {
            for (const item of property.value) {
                const chip = document.createElement('span');
                chip.className = 'cm-frontmatter-chip';
                chip.textContent = item;
                value.appendChild(chip);
            }
        } else if (property.nested) {
            // A shape this subset does not model: say so rather than show a
            // confident, wrong single line.
            value.textContent = property.value || '…';
            value.classList.add('cm-frontmatter-nested');
            value.title = 'Nested value — click to edit the raw YAML';
        } else {
            value.textContent = property.value;
        }

        row.append(key, value);
        tbody.appendChild(row);
    }

    table.appendChild(tbody);
    wrap.appendChild(table);
    wrap.appendChild(spacer());
    return wrap;
}

class FrontmatterWidget extends WidgetType {
    constructor(body) {
        super();
        this.body = body;
    }

    eq(other) {
        return other.body === this.body;
    }

    toDOM() {
        return renderProperties(this.body);
    }

    ignoreEvent() {
        return false; // a click has to reach the editor: that is how you edit it
    }
}

/** The block's range, so other decorations can stay out of it. */
export function frontmatterRange(state) {
    const block = findFrontmatter(state.doc.sliceString(0, Math.min(state.doc.length, 8192)));
    return block ? { from: block.from, to: block.to } : null;
}

function build(state) {
    const range = frontmatterRange(state);
    if (!range) return Decoration.none;

    // Caret inside: show the YAML. It is the only way to edit it, and the only
    // thing an editor can honestly do with a shape it does not fully model.
    const inside = state.selection.ranges.some(selection => selection.from <= range.to && selection.to >= range.from);
    if (inside) return Decoration.none;

    const body = state.doc.sliceString(range.from, range.to).split('\n').slice(1, -1).join('\n');
    return Decoration.set([
        Decoration.replace({ widget: new FrontmatterWidget(body), block: true }).range(range.from, range.to),
    ]);
}

export const frontmatter = StateField.define({
    create: state => build(state),
    update: (decorations, transaction) =>
        transaction.docChanged || transaction.selection ? build(transaction.state) : decorations,
    provide: field => [
        EditorView.decorations.from(field),
        // Atomic while rendered, so ArrowUp/Down stop at its edge instead of
        // stepping through lines that are not displayed.
        EditorView.atomicRanges.of(view => view.state.field(field, false) || Decoration.none),
    ],
});

export const frontmatterTheme = EditorView.theme({
    // Padding, never margin. A block widget's height comes from its border
    // box: a margin is space CodeMirror cannot see, so every position below it
    // is off by that much — which is a caret landing on the wrong line.
    '.cm-frontmatter': {
        border: '1px solid var(--border)',
        borderRadius: '10px',
        background: 'var(--bg-side)',
        padding: '10px 12px',
        marginBottom: '0',
        fontFamily: 'var(--sans)',
        fontSize: '0.85em',
        cursor: 'text',
    },
    // The gap under the block, inside the measured element.
    '.cm-frontmatter-spacer': { height: '1.2em' },
    '.cm-frontmatter-head': {
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        fontSize: '0.72em',
        fontWeight: '700',
        color: 'var(--text-dim)',
        marginBottom: '6px',
    },
    '.cm-frontmatter table': { borderCollapse: 'collapse', width: '100%' },
    '.cm-frontmatter th': {
        textAlign: 'left',
        fontWeight: '600',
        color: 'var(--text-dim)',
        padding: '2px 12px 2px 0',
        verticalAlign: 'top',
        whiteSpace: 'nowrap',
        width: '1%',
    },
    '.cm-frontmatter td': { padding: '2px 0', verticalAlign: 'top' },
    '.cm-frontmatter-chip': {
        display: 'inline-block',
        background: 'var(--code-bg)',
        border: '1px solid var(--border)',
        borderRadius: '999px',
        padding: '0 8px',
        marginRight: '4px',
        fontSize: '0.92em',
    },
    '.cm-frontmatter-nested': { color: 'var(--text-dim)', fontStyle: 'italic' },
    '.cm-frontmatter-empty': { color: 'var(--text-dim)', fontStyle: 'italic' },
});
