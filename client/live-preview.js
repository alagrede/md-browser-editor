// Live preview: the markdown renders in place, and the source of whatever the
// caret sits in comes back so it stays editable. One editor, no split, no
// preview pane — the Znote/Obsidian model.
//
// Everything here is a decoration over the Lezer markdown tree:
//   - syntax marks (#, **, `, >) are REPLACED with nothing when the caret is
//     outside their element, and left alone when it is inside;
//   - images and horizontal rules are replaced by a widget;
//   - headings, quotes, code fences and list lines get a class to style.
//
// Deliberately not here: code execution of any kind, and tables, which stay as
// source (see the README's limits).
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import { RangeSet } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { frontmatterRange } from './frontmatter.js';
import { assetUrl, docPath, rootAssetUrl } from './doc-path.js';
import { tableRangesOf } from './table.js';

/** Marks hidden by replacing them with nothing. */
const HIDE = Decoration.replace({});

/** Marks folded away when the caret is outside the element they belong to. */
const INLINE_MARKS = new Set(['EmphasisMark', 'CodeMark', 'StrikethroughMark', 'HeaderMark', 'QuoteMark']);

/**
 * A fence's ``` is a CodeMark too. Folding it away left the info string alone
 * on its line ("sh" floating above the code), so fences stay visible and are
 * styled as part of the block instead.
 */
function isFenceMark(node) {
    const parent = node.node.parent;
    return node.name === 'CodeMark' && parent && parent.name !== 'InlineCode';
}

const ELEMENT_CLASS = {
    ATXHeading1: 'cm-md-h1',
    ATXHeading2: 'cm-md-h2',
    ATXHeading3: 'cm-md-h3',
    ATXHeading4: 'cm-md-h4',
    ATXHeading5: 'cm-md-h5',
    ATXHeading6: 'cm-md-h6',
    StrongEmphasis: 'cm-md-strong',
    Emphasis: 'cm-md-em',
    InlineCode: 'cm-md-code',
    Strikethrough: 'cm-md-strike',
};

class ImageWidget extends WidgetType {
    constructor(url, alt, from) {
        super();
        this.url = url;
        this.alt = alt;
        this.from = from; // the document carrying the reference
    }

    eq(other) {
        return other.url === this.url && other.alt === this.alt && other.from === this.from;
    }

    toDOM() {
        const wrap = document.createElement('span');
        wrap.className = 'cm-md-image';
        const img = document.createElement('img');
        img.alt = this.alt ?? '';

        const relative = assetUrl(this.url, this.from);
        const fromRoot = rootAssetUrl(this.url);

        // Relative to the document first — that is what markdown means. A
        // shared folder at the root is the other convention in the wild, so a
        // miss falls back to it once before giving up.
        let tried = false;
        img.onerror = () => {
            if (!tried && fromRoot && fromRoot !== relative) {
                tried = true;
                img.src = fromRoot;
                return;
            }
            wrap.classList.add('cm-md-image-broken');
            wrap.textContent = `🖼 ${this.alt || this.url}`;
        };
        img.src = relative ?? this.url;

        wrap.appendChild(img);
        return wrap;
    }

    ignoreEvent() {
        return true;
    }
}

class RuleWidget extends WidgetType {
    eq() {
        return true;
    }

    toDOM() {
        const hr = document.createElement('hr');
        hr.className = 'cm-md-rule';
        return hr;
    }
}

/** True when a selection range touches [from, to] — the "caret is inside" test. */
function touches(state, from, to) {
    return state.selection.ranges.some(range => range.from <= to && range.to >= from);
}

function buildDecorations(view) {
    const { state } = view;
    const decorations = [];
    // The frontmatter has its own widget, and markdown reads it as a setext
    // heading — decorating it would both overlap the widget and style the raw
    // YAML as a title while it is being edited.
    // Tables are a block widget of their own; decorating their source would
    // overlap it. The ranges come from the table field, which already scanned
    // for them — this runs on every cursor move.
    const tables = tableRangesOf(state);
    const inTable = (from, to) => tables.some(range => from >= range.from && to <= range.to);

    const frontmatter = frontmatterRange(state);
    // Containment, not overlap: the tree's root node spans the whole document
    // and therefore overlaps the frontmatter — testing overlap skipped every
    // decoration in the file, not just the block's own.
    const inFrontmatter = (from, to) => frontmatter && from >= frontmatter.from && to <= frontmatter.to;
    const lineClasses = new Map(); // line start → class, deduped

    const addLine = (pos, className) => {
        const line = state.doc.lineAt(pos);
        const existing = lineClasses.get(line.from);
        lineClasses.set(line.from, existing ? `${existing} ${className}` : className);
    };

    for (const { from, to } of view.visibleRanges) {
        syntaxTree(state).iterate({
            from,
            to,
            enter: node => {
                const name = node.name;
                if (inFrontmatter(node.from, node.to) || inTable(node.from, node.to)) return false;


                if (name === 'Image') {
                    if (touches(state, node.from, node.to)) return false;
                    const raw = state.doc.sliceString(node.from, node.to);
                    const match = /^!\[([^\]]*)\]\(\s*(?:<([^>]*)>|([^)\s]*))[^)]*\)$/.exec(raw);
                    if (match) {
                        const url = match[2] !== undefined ? match[2] : match[3];
                        decorations.push({
                            from: node.from,
                            to: node.to,
                            deco: Decoration.replace({
                                widget: new ImageWidget(url, match[1], state.facet(docPath)),
                            }),
                        });
                    }
                    return false;
                }

                if (name === 'HorizontalRule') {
                    if (touches(state, node.from, node.to)) return false;
                    decorations.push({ from: node.from, to: node.to, deco: Decoration.replace({ widget: new RuleWidget() }) });
                    return false;
                }

                if (ELEMENT_CLASS[name]) {
                    const className = ELEMENT_CLASS[name];
                    if (name.startsWith('ATXHeading')) addLine(node.from, className);
                    else decorations.push({ from: node.from, to: node.to, deco: Decoration.mark({ class: className }) });
                    return;
                }

                if (name === 'FencedCode' || name === 'CodeBlock') {
                    for (let pos = node.from; pos <= node.to; ) {
                        const line = state.doc.lineAt(pos);
                        addLine(line.from, 'cm-md-codeblock');
                        if (line.to >= node.to) break;
                        pos = line.to + 1;
                    }
                    return;
                }

                if (name === 'Blockquote') {
                    for (let pos = node.from; pos <= node.to; ) {
                        const line = state.doc.lineAt(pos);
                        addLine(line.from, 'cm-md-quote');
                        if (line.to >= node.to) break;
                        pos = line.to + 1;
                    }
                    return;
                }

                if (name === 'Link') {
                    // [text](url): the destination folds away, the label stays.
                    if (touches(state, node.from, node.to)) return false;
                    const raw = state.doc.sliceString(node.from, node.to);
                    const match = /^\[([^\]]*)\]\((.*)\)$/.exec(raw);
                    if (!match) return false;
                    const labelFrom = node.from + 1;
                    const labelTo = labelFrom + match[1].length;
                    decorations.push({ from: node.from, to: labelFrom, deco: HIDE });
                    decorations.push({
                        from: labelFrom,
                        to: labelTo,
                        deco: Decoration.mark({ class: 'cm-md-link', attributes: { 'data-href': match[2] } }),
                    });
                    decorations.push({ from: labelTo, to: node.to, deco: HIDE });
                    return false;
                }

                if (INLINE_MARKS.has(name)) {
                    if (isFenceMark(node)) return;
                    const parent = node.node.parent;
                    const scopeFrom = parent ? parent.from : node.from;
                    const scopeTo = parent ? parent.to : node.to;
                    if (touches(state, scopeFrom, scopeTo)) return;
                    // A heading's "# " swallows the space after it, so the text
                    // does not start one column in from the line's left edge.
                    const end = name === 'HeaderMark' ? Math.min(node.to + 1, state.doc.lineAt(node.to).to) : node.to;
                    if (end > node.from) decorations.push({ from: node.from, to: end, deco: HIDE });
                    return;
                }

                if (name === 'CodeMark' && isFenceMark(node)) {
                    decorations.push({ from: node.from, to: node.to, deco: Decoration.mark({ class: 'cm-md-fence' }) });
                    return;
                }

                if (name === 'ListMark') {
                    decorations.push({ from: node.from, to: node.to, deco: Decoration.mark({ class: 'cm-md-listmark' }) });
                }
            },
        });
    }

    for (const [from, className] of lineClasses) {
        decorations.push({ from, to: from, deco: Decoration.line({ class: className }), line: true });
    }

    decorations.sort((a, b) => a.from - b.from || (a.line ? -1 : 0) - (b.line ? -1 : 0) || a.to - b.to);
    return RangeSet.of(
        decorations.map(item => item.deco.range(item.from, item.to)),
        true
    );
}

export const livePreview = ViewPlugin.fromClass(
    class {
        constructor(view) {
            this.decorations = buildDecorations(view);
        }

        update(update) {
            if (update.docChanged || update.viewportChanged || update.selectionSet) {
                this.decorations = buildDecorations(update.view);
            }
        }
    },
    {
        decorations: plugin => plugin.decorations,
        eventHandlers: {
            // A rendered link opens in a new tab on ⌘/Ctrl-click, like an editor.
            mousedown(event) {
                const target = event.target.closest?.('.cm-md-link');
                if (!target || !(event.metaKey || event.ctrlKey)) return false;
                const href = target.getAttribute('data-href');
                if (!href) return false;
                event.preventDefault();
                window.open(href, '_blank', 'noopener');
                return true;
            },
        },
    }
);

/** Styling for everything the plugin marks up. */
export const livePreviewTheme = EditorView.theme({
    '.cm-md-h1': { fontSize: '1.9em', fontWeight: '700', lineHeight: '1.25' },
    '.cm-md-h2': { fontSize: '1.5em', fontWeight: '700', lineHeight: '1.3' },
    '.cm-md-h3': { fontSize: '1.25em', fontWeight: '650' },
    '.cm-md-h4': { fontSize: '1.1em', fontWeight: '650' },
    '.cm-md-h5, .cm-md-h6': { fontSize: '1em', fontWeight: '650', opacity: '0.85' },
    '.cm-md-strong': { fontWeight: '700' },
    '.cm-md-em': { fontStyle: 'italic' },
    '.cm-md-strike': { textDecoration: 'line-through', opacity: '0.7' },
    '.cm-md-code': {
        fontFamily: 'var(--mono)',
        fontSize: '0.9em',
        background: 'var(--code-bg)',
        borderRadius: '4px',
        padding: '0.1em 0.35em',
    },
    '.cm-md-codeblock': {
        fontFamily: 'var(--mono)',
        fontSize: '0.9em',
        background: 'var(--code-bg)',
    },
    '.cm-md-codeblock .cm-md-fence': { color: 'var(--text-dim)' },
    '.cm-md-quote': {
        borderLeft: '3px solid var(--accent)',
        paddingLeft: '0.9em',
        color: 'var(--text-dim)',
        fontStyle: 'italic',
    },
    '.cm-md-listmark': { color: 'var(--accent)' },
    '.cm-md-link': { color: 'var(--accent)', textDecoration: 'underline', cursor: 'pointer' },
    '.cm-md-image img': { maxWidth: '100%', borderRadius: '8px', display: 'block', margin: '0.4em 0' },
    '.cm-md-image-broken': { color: 'var(--text-dim)', fontStyle: 'italic' },
    '.cm-md-rule': { border: '0', borderTop: '1px solid var(--border)', margin: '0.6em 0' },
});
