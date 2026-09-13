// Markdown tables, rendered as tables and editable in place — the Znote model.
//
// The source lines are replaced by a block widget. A cell shows its rendered
// text; clicking one swaps it for an input holding the RAW markdown, and
// committing serializes the whole model back into the document. So the file
// stays the only state: the widget never holds anything the markdown does not.
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import { RangeSet, StateField } from '@codemirror/state';
import { findFrontmatter } from '../src/frontmatter.mjs';

// --- finding tables ---------------------------------------------------------

// Deliberately a line scan rather than the syntax tree. CodeMirror parses
// lazily: syntaxTree(state) only covers what has been parsed so far, so a table
// far down a long document has no Table node when the field is built, and the
// field would have to be rebuilt every time the parser advances. A table's
// grammar is three lines of rules — scanning for it is both simpler and exact.

const splitCells = line =>
    line
        .trim()
        .replace(/^\|/, '')
        .replace(/(?<!\\)\|$/, '')
        .split(/(?<!\\)\|/);

const hasPipe = line => /(?<!\\)\|/.test(line);

const isDelimiter = line => {
    if (!hasPipe(line)) return false;
    const cells = splitCells(line);
    return cells.length > 0 && cells.every(cell => /^\s*:?-+:?\s*$/.test(cell));
};

const isRow = line => line.trim().length > 0 && hasPipe(line) && !isDelimiter(line);

/**
 * Every table in `text`, as {from, to} offsets.
 *
 * A table is a row, a delimiter row with the SAME number of cells (what GFM
 * requires, and what makes a false positive on prose essentially impossible),
 * then rows until a line that is not one. Fenced code is skipped — a shell
 * snippet piping into jq is full of pipes — and so is the frontmatter.
 */
export function findTableRanges(text) {
    const source = String(text ?? '');
    const lines = source.split('\n');

    // Offset of the start of each line, so a range can be reported in the
    // document's own coordinates.
    const offsets = [];
    let cursor = 0;
    for (const line of lines) {
        offsets.push(cursor);
        cursor += line.length + 1;
    }

    const frontmatter = findFrontmatter(source);
    const ranges = [];
    let fence = null;

    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];

        if (frontmatter && offsets[index] < frontmatter.to) continue;

        const fenceMark = /^\s{0,3}(```+|~~~+)/.exec(line);
        if (fenceMark) {
            if (!fence) fence = fenceMark[1][0];
            else if (fenceMark[1][0] === fence) fence = null;
            continue;
        }
        if (fence) continue;

        const next = lines[index + 1];
        if (
            next === undefined ||
            !isRow(line) ||
            !isDelimiter(next) ||
            splitCells(line).length !== splitCells(next).length
        ) {
            continue;
        }

        let end = index + 1;
        while (end + 1 < lines.length && isRow(lines[end + 1])) end += 1;

        ranges.push({ from: offsets[index], to: offsets[end] + lines[end].length });
        index = end;
    }

    return ranges;
}

// --- model ------------------------------------------------------------------

// Split on unescaped pipes only: a cell may legitimately contain "a \| b",
// and splitting on it would turn one cell into two on the next parse. The
// model holds the logical text, so serializeTable re-escapes on the way out.
const splitRow = line =>
    line
        .trim()
        .replace(/^\||(?<!\\)\|$/g, '')
        .split(/(?<!\\)\|/)
        .map(cell => cell.trim().replace(/\\\|/g, '|'));

const parseAlign = spec => {
    const text = spec.trim();
    const left = text.startsWith(':');
    const right = text.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return '';
};

export function parseTable(source) {
    const lines = source.split('\n').filter(line => line.trim().length > 0);
    return {
        header: lines.length ? splitRow(lines[0]) : [],
        aligns: lines.length > 1 ? splitRow(lines[1]).map(parseAlign) : [],
        rows: lines.slice(2).map(splitRow),
    };
}

export function serializeTable(model) {
    // The widest row wins, header included: a row that somehow carries more
    // cells than the header keeps them (with an unnamed column) rather than
    // having them silently dropped on the next save.
    const columns = Math.max(1, model.header.length, ...model.rows.map(row => row.length));
    const pad = list => {
        const copy = list.slice(0, columns);
        while (copy.length < columns) copy.push('');
        return copy;
    };
    const cell = value => {
        const text = String(value ?? '').trim();
        // A cell may not hold a raw pipe: it would split the row in two.
        return (text.length ? text : ' ').replace(/\|/g, '\\|');
    };
    const line = list => `| ${pad(list).map(cell).join(' | ')} |`;
    const delimiter = pad(model.aligns).map(align => {
        if (align === 'center') return ':---:';
        if (align === 'right') return '---:';
        if (align === 'left') return ':---';
        return '---';
    });

    return [line(model.header), `| ${delimiter.join(' | ')} |`, ...model.rows.map(line)].join('\n');
}

const alignLabel = align =>
    align === 'left' ? '⭰' : align === 'center' ? '↔' : align === 'right' ? '⭲' : '⇥';

/** Minimal inline rendering for a cell: enough to read, never enough to lose. */
function cellHtml(raw) {
    const escaped = String(raw)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    return escaped
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

// --- widget -----------------------------------------------------------------

class TableWidget extends WidgetType {
    constructor(source, from, to) {
        super();
        this.source = source;
        this.from = from;
        this.to = to;
    }

    eq(other) {
        return other.source === this.source;
    }

    toDOM(view) {
        return renderTable(this.source, view, this);
    }

    ignoreEvent() {
        return true;
    }
}

function renderTable(source, view, widget) {
    const model = parseTable(source);
    const wrap = document.createElement('div');
    wrap.className = 'cm-md-table-wrap';

    const table = document.createElement('table');
    table.className = 'cm-md-table';

    /** Writes the model back into the document, replacing the table's lines. */
    const commit = next => {
        const markdown = serializeTable(next);
        const current = view.state.sliceDoc(widget.from, widget.to);
        if (markdown === current) return;
        view.dispatch({ changes: { from: widget.from, to: widget.to, insert: markdown } });
    };

    /** The model as the DOM currently has it, in-progress edit included. */
    const readDom = () => {
        const headCells = [...table.querySelectorAll('thead th')];
        return {
            header: headCells.map(raw),
            aligns: headCells.map(cell => cell.dataset.align || ''),
            rows: [...table.querySelectorAll('tbody tr')].map(row => [...row.querySelectorAll('td')].map(raw)),
        };
    };
    const raw = cell => {
        const input = cell.querySelector('input');
        return (input ? input.value : cell.dataset.raw ?? '').trim();
    };
    const edit = fn => {
        const next = readDom();
        fn(next);
        commit(next);
    };

    const makeCell = (tag, text, align, column, row) => {
        const cell = document.createElement(tag);
        cell.dataset.raw = text;
        cell.dataset.column = String(column);
        if (row != null) cell.dataset.row = String(row);
        if (align) {
            cell.dataset.align = align;
            cell.style.textAlign = align;
        }
        cell.innerHTML = text.trim() ? cellHtml(text) : '&nbsp;';
        cell.addEventListener('mousedown', event => {
            if (event.target.tagName === 'A') return; // let a link be a link
            event.preventDefault();
            openEditor(cell);
        });
        return cell;
    };

    /** Click to edit: the cell becomes an input holding its raw markdown. */
    function openEditor(cell) {
        if (cell.querySelector('input')) return;
        const input = document.createElement('input');
        input.type = 'text';
        input.value = cell.dataset.raw ?? '';
        input.className = 'cm-md-table-input';
        cell.textContent = '';
        cell.appendChild(input);
        input.focus();
        input.select();

        const close = ({ commitEdit = true, move = 0 } = {}) => {
            const value = input.value;
            cell.dataset.raw = value;
            cell.innerHTML = value.trim() ? cellHtml(value) : '&nbsp;';
            if (commitEdit) edit(next => assign(next, cell, value));
            if (move) focusNeighbour(cell, move);
        };

        input.addEventListener('blur', () => close());
        input.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                input.blur();
            } else if (event.key === 'Escape') {
                event.preventDefault();
                input.value = cell.dataset.raw ?? '';
                close({ commitEdit: false });
            } else if (event.key === 'Tab') {
                event.preventDefault();
                close({ move: event.shiftKey ? -1 : 1 });
            }
        });
    }

    const assign = (next, cell, value) => {
        const column = Number(cell.dataset.column);
        if (cell.dataset.row === undefined) next.header[column] = value;
        else next.rows[Number(cell.dataset.row)][column] = value;
    };

    const focusNeighbour = (cell, direction) => {
        const cells = [...table.querySelectorAll('th, td')];
        const next = cells[cells.indexOf(cell) + direction];
        if (next) openEditor(next);
    };

    const headRow = document.createElement('tr');
    model.header.forEach((text, column) => headRow.appendChild(makeCell('th', text, model.aligns[column], column)));
    const head = document.createElement('thead');
    head.appendChild(headRow);
    table.appendChild(head);

    const body = document.createElement('tbody');
    model.rows.forEach((row, index) => {
        const tr = document.createElement('tr');
        model.header.forEach((_, column) =>
            tr.appendChild(makeCell('td', row[column] ?? '', model.aligns[column], column, index))
        );
        body.appendChild(tr);
    });
    table.appendChild(body);
    wrap.appendChild(table);

    // --- structure buttons --------------------------------------------------
    const button = (className, label, title, onClick) => {
        const element = document.createElement('button');
        element.className = className;
        element.textContent = label;
        element.title = title;
        element.addEventListener('mousedown', event => {
            event.preventDefault();
            event.stopPropagation();
            onClick();
        });
        return element;
    };

    wrap.appendChild(
        button('cm-md-table-plus cm-md-table-plus-col', '＋', 'Add a column', () =>
            edit(next => {
                next.header.push('');
                next.aligns.push('');
                next.rows.forEach(row => row.push(''));
            })
        )
    );
    wrap.appendChild(
        button('cm-md-table-plus cm-md-table-plus-row', '＋', 'Add a row', () =>
            edit(next => next.rows.push(new Array(Math.max(next.header.length, 1)).fill('')))
        )
    );

    // Column controls, on hover of the header cell: alignment (the delimiter
    // row is not reachable any other way once the table is rendered) and
    // removal. A one-column table has nothing to remove.
    const ALIGNS = ['', 'left', 'center', 'right'];
    model.header.forEach((_, column) => {
        const cell = headRow.children[column];
        if (!cell) return;
        const current = model.aligns[column] || '';
        cell.appendChild(
            button('cm-md-table-align', alignLabel(current), `Alignment: ${current || 'default'}`, () =>
                edit(next => {
                    const index = ALIGNS.indexOf(next.aligns[column] || '');
                    next.aligns[column] = ALIGNS[(index + 1) % ALIGNS.length];
                })
            )
        );
        if (model.header.length <= 1) return;
        cell.appendChild(
            button('cm-md-table-drop', '✕', 'Delete this column', () =>
                edit(next => {
                    next.header.splice(column, 1);
                    next.aligns.splice(column, 1);
                    next.rows.forEach(row => row.splice(column, 1));
                })
            )
        );
    });
    [...body.children].forEach((tr, index) => {
        tr.children[0]?.appendChild(
            button('cm-md-table-drop cm-md-table-drop-row', '✕', 'Delete this row', () =>
                edit(next => next.rows.splice(index, 1))
            )
        );
    });

    return wrap;
}

// --- plugin -----------------------------------------------------------------

// A StateField, not a ViewPlugin: CodeMirror refuses block decorations coming
// from a plugin ("Block decorations may not be specified via plugins"), because
// they change the height of lines the viewport was measured with.
function buildDecorations(state) {
    const ranges = findTableRanges(state.doc.toString());

    return RangeSet.of(
        ranges.map(range =>
            Decoration.replace({
                widget: new TableWidget(state.sliceDoc(range.from, range.to), range.from, range.to),
                block: true,
            }).range(range.from, range.to)
        ),
        true
    );
}

/**
 * The table ranges the field already holds. Recomputing them per keystroke —
 * and the doc.toString() they need — would put a full-document scan on the
 * cursor's path; the field only rebuilds when the document changes.
 */
export function tableRangesOf(state) {
    const decorations = state.field(tables, false);
    if (!decorations) return [];
    const ranges = [];
    const cursor = decorations.iter();
    while (cursor.value) {
        ranges.push({ from: cursor.from, to: cursor.to });
        cursor.next();
    }
    return ranges;
}

export const tables = StateField.define({
    create: state => buildDecorations(state),
    update: (decorations, transaction) =>
        transaction.docChanged ? buildDecorations(transaction.state) : decorations,
    provide: field => EditorView.decorations.from(field),
});

export const tableTheme = EditorView.theme({
    // Padding, not margin: a block widget is measured by its border box, and a
    // margin is height CodeMirror never learns about — the caret then lands
    // that far off everywhere below the table.
    '.cm-md-table-wrap': {
        position: 'relative',
        margin: '0',
        paddingTop: '0.6em',
        paddingRight: '18px',
        paddingBottom: 'calc(18px + 1.2em)',
    },
    '.cm-md-table': {
        borderCollapse: 'collapse',
        width: '100%',
        fontSize: '0.92em',
        fontFamily: 'var(--sans)',
    },
    '.cm-md-table th, .cm-md-table td': {
        border: '1px solid var(--border)',
        padding: '5px 9px',
        textAlign: 'left',
        verticalAlign: 'top',
        position: 'relative',
    },
    '.cm-md-table th': { background: 'var(--code-bg)', fontWeight: '650' },
    '.cm-md-table td:hover, .cm-md-table th:hover': { background: 'var(--row-hover)', cursor: 'text' },
    '.cm-md-table code': { fontFamily: 'var(--mono)', fontSize: '0.9em', background: 'var(--code-bg)', borderRadius: '3px', padding: '0 0.25em' },
    '.cm-md-table a': { color: 'var(--accent)' },
    '.cm-md-table-input': {
        width: '100%',
        border: '0',
        outline: '2px solid var(--accent)',
        outlineOffset: '1px',
        background: 'var(--bg)',
        color: 'var(--text)',
        font: 'inherit',
        padding: '0',
        borderRadius: '2px',
    },
    '.cm-md-table-plus': {
        position: 'absolute',
        border: '1px dashed var(--border)',
        background: 'var(--bg)',
        color: 'var(--text-dim)',
        borderRadius: '6px',
        cursor: 'pointer',
        padding: '0',
        fontSize: '11px',
        lineHeight: '1',
        opacity: '0',
        transition: 'opacity 120ms',
    },
    '.cm-md-table-wrap:hover .cm-md-table-plus': { opacity: '1' },
    '.cm-md-table-plus-col': { top: '0', right: '0', width: '14px', bottom: '18px' },
    '.cm-md-table-plus-row': { left: '0', bottom: '0', height: '14px', right: '18px' },
    '.cm-md-table-align': {
        position: 'absolute',
        top: '2px',
        right: '16px',
        border: '0',
        background: 'transparent',
        color: 'var(--text-dim)',
        cursor: 'pointer',
        fontSize: '10px',
        lineHeight: '1',
        padding: '2px',
        opacity: '0',
    },
    '.cm-md-table th:hover .cm-md-table-align': { opacity: '0.75' },
    '.cm-md-table-align:hover': { opacity: '1', color: 'var(--accent)' },
    '.cm-md-table-drop': {
        position: 'absolute',
        top: '2px',
        right: '2px',
        border: '0',
        background: 'transparent',
        color: 'var(--text-dim)',
        cursor: 'pointer',
        fontSize: '9px',
        lineHeight: '1',
        padding: '2px',
        opacity: '0',
    },
    '.cm-md-table th:hover .cm-md-table-drop, .cm-md-table td:hover .cm-md-table-drop': { opacity: '0.75' },
    '.cm-md-table-drop:hover': { opacity: '1', color: 'var(--error)' },
});
