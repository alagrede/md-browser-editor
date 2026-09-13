// The table model is what turns cell edits back into markdown: pure string
// work, and the only place a table can be silently corrupted.
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTable, serializeTable } from '../client/table.js';

const TABLE = ['| Command | Does | Writes? |', '| --- | :--- | :---: |', '| `serve` | serves | no |'].join('\n');

test('a table parses into header, alignments and rows', () => {
    const model = parseTable(TABLE);
    assert.deepEqual(model.header, ['Command', 'Does', 'Writes?']);
    assert.deepEqual(model.aligns, ['', 'left', 'center']);
    assert.deepEqual(model.rows, [['`serve`', 'serves', 'no']]);
});

test('parse → serialize keeps the table meaning, alignments included', () => {
    const again = parseTable(serializeTable(parseTable(TABLE)));
    assert.deepEqual(again, parseTable(TABLE));
    assert.match(serializeTable(parseTable(TABLE)), /\| --- \| :--- \| :---: \|/);
});

test('a short row is padded, and an over-long one widens the table', () => {
    // Dropping the extra cell would lose what someone typed; an unnamed
    // column is visible, and fixable in one click.
    const markdown = serializeTable({ header: ['a', 'b', 'c'], aligns: [], rows: [['1'], ['1', '2', '3', '4']] });
    const model = parseTable(markdown);
    assert.equal(model.header.length, 4);
    assert.deepEqual(model.rows, [
        ['1', '', '', ''],
        ['1', '2', '3', '4'],
    ]);
});

test('an empty cell stays a cell', () => {
    // "||" would collapse the column on the next parse.
    const markdown = serializeTable({ header: ['a', 'b'], aligns: [], rows: [['', 'x']] });
    assert.match(markdown, /\|   \| x \|/);
    assert.deepEqual(parseTable(markdown).rows, [['', 'x']]);
});

test('a pipe typed in a cell is escaped instead of splitting the row', () => {
    const markdown = serializeTable({ header: ['cmd', 'note'], aligns: [], rows: [['a | b', 'x']] });
    const model = parseTable(markdown);
    assert.equal(model.header.length, 2);
    assert.equal(model.rows[0].length, 2);
    assert.equal(model.rows[0][0], 'a | b', 'the model holds the logical text');
    assert.match(markdown, /a \\\| b/, 'the file holds it escaped');
    assert.equal(serializeTable(model), markdown, 'and the round trip is stable');
});

test('a table with no rows still round-trips', () => {
    const markdown = serializeTable({ header: ['a', 'b'], aligns: ['right', ''], rows: [] });
    const model = parseTable(markdown);
    assert.deepEqual(model.header, ['a', 'b']);
    assert.deepEqual(model.aligns, ['right', '']);
    assert.deepEqual(model.rows, []);
});
