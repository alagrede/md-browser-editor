// The formatting commands, run against a real CodeMirror state — headless, no
// browser needed. What they must get right is being toggles: a command that
// only ever adds is one you undo by hand.
import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorState } from '@codemirror/state';
import {
    clearFormatting,
    insertLink,
    insertTable,
    setHeading,
    toggleBold,
    toggleBullet,
    toggleItalic,
    toggleOrdered,
    toggleQuote,
} from '../client/format.js';

/** A view thin enough to run a command and read the result. */
function editor(doc, selection) {
    let state = EditorState.create({ doc, selection });
    return {
        get doc() {
            return state.doc.toString();
        },
        get selection() {
            const { from, to } = state.selection.main;
            return state.sliceDoc(from, to);
        },
        get state() {
            return state;
        },
        dispatch(transaction) {
            state = state.update(transaction).state;
        },
        run(command) {
            return command(this);
        },
    };
}

test('bold wraps the selection and keeps it selected', () => {
    const view = editor('un mot ici', { anchor: 3, head: 6 });
    view.run(toggleBold);
    assert.equal(view.doc, 'un **mot** ici');
    assert.equal(view.selection, 'mot');
});

test('bold on bold takes it off', () => {
    // Markers inside the selection…
    const inside = editor('un **mot** ici', { anchor: 3, head: 10 });
    inside.run(toggleBold);
    assert.equal(inside.doc, 'un mot ici');

    // …and markers just outside it, which is what you get by double-clicking.
    const outside = editor('un **mot** ici', { anchor: 5, head: 8 });
    outside.run(toggleBold);
    assert.equal(outside.doc, 'un mot ici');
});

test('with no selection it leaves the caret between the markers', () => {
    const view = editor('début ', { anchor: 6 });
    view.run(toggleItalic);
    assert.equal(view.doc, 'début **');
    assert.equal(view.state.selection.main.head, 7, 'ready to type inside');
});

test('a heading is a toggle, and switching level replaces it', () => {
    const view = editor('Titre', { anchor: 0 });
    view.run(setHeading(2));
    assert.equal(view.doc, '## Titre');
    view.run(setHeading(3));
    assert.equal(view.doc, '### Titre', 'the old level does not stack');
    view.run(setHeading(3));
    assert.equal(view.doc, 'Titre', 'the same level again removes it');
});

test('lists apply to every selected line, and number themselves', () => {
    const view = editor('un\ndeux\ntrois', { anchor: 0, head: 13 });
    view.run(toggleBullet);
    assert.equal(view.doc, '- un\n- deux\n- trois');
    view.run(toggleBullet);
    assert.equal(view.doc, 'un\ndeux\ntrois');
    view.run(toggleOrdered);
    assert.equal(view.doc, '1. un\n2. deux\n3. trois');
});

test('a quote keeps the indentation it found', () => {
    const view = editor('  décalé', { anchor: 2 });
    view.run(toggleQuote);
    assert.equal(view.doc, '  > décalé');
});

test('clearing formatting keeps the words', () => {
    const view = editor('## **Gras** et `code`', { anchor: 0, head: 21 });
    view.run(clearFormatting);
    assert.equal(view.doc, 'Gras et code');
});

test('a link wraps the selection and lands the caret in the target', () => {
    const view = editor('voir la doc', { anchor: 8, head: 11 });
    view.run(insertLink(false));
    assert.equal(view.doc, 'voir la [doc]()');
    assert.equal(view.state.selection.main.head, 14, 'inside the parentheses');
});

test('a table is inserted below, with its first header selected', () => {
    const view = editor('Du texte.', { anchor: 9 });
    view.run(insertTable);
    assert.match(view.doc, /Du texte\.\n\n\| Column \| Column \|\n\| --- \| --- \|/);
    assert.equal(view.selection, 'Column', 'ready to be typed over');
});

test('inserting keeps exactly one blank line above the block', () => {
    // The caret's own blank line IS the separator markdown needs: consuming it
    // glued the table to the paragraph above, and the two then parsed as one.
    const onBlank = editor('Titre\n\n', { anchor: 6 });
    onBlank.run(insertTable);
    assert.equal(onBlank.doc.startsWith('Titre\n\n| Column'), true);

    const inText = editor('Du texte.', { anchor: 3 });
    inText.run(insertTable);
    assert.equal(inText.doc.startsWith('Du texte.\n\n| Column'), true);

    const empty = editor('', { anchor: 0 });
    empty.run(insertTable);
    assert.equal(empty.doc.startsWith('| Column'), true, 'nothing above, nothing to separate from');
});
