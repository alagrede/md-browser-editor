// The mention format is the contract between the editor, the CLI and whatever
// agent reads the files. It is the piece that must not drift.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
    insertMention,
    newMentionId,
    parseMentions,
    removeAllMentions,
    removeMention,
    sanitizePrompt,
} from '../src/mentions.mjs';

test('wrapping a selection, then removing it, is a round trip', () => {
    const source = '# Titre\n\nUn paragraphe technique.\n\nAutre chose.\n';
    const from = source.indexOf('Un paragraphe');
    const to = source.indexOf('.\n\nAutre') + 1;

    const { id, source: annotated } = insertMention(source, from, to, 'Reformule ça');
    assert.match(annotated, /<!--ai:[a-z0-9]+ Reformule ça-->Un paragraphe technique\.<!--\/ai:[a-z0-9]+-->/);
    assert.equal(removeMention(annotated, id), source);
});

test('a mention reports its instruction, its text and where it starts', () => {
    const source = 'Intro.\n\n<!--ai:a3f Résume cette partie-->\nDeux lignes\nde texte.\n<!--/ai:a3f-->\n';
    const [mention] = parseMentions(source);

    assert.equal(mention.id, 'a3f');
    assert.equal(mention.prompt, 'Résume cette partie');
    assert.equal(mention.text, 'Deux lignes\nde texte.');
    assert.equal(mention.unterminated, false);
    assert.equal(source.slice(mention.from, mention.from + 8), '<!--ai:a');
});

test('a block selection puts the markers on their own lines', () => {
    // A marker glued to the front of "## Titre" would stop it being a heading.
    const source = 'a\n## Titre\nligne\nb\n';
    const from = source.indexOf('## Titre');
    const to = source.indexOf('\nb\n') + 1;
    const { source: annotated } = insertMention(source, from, to, 'Développe');

    assert.match(annotated, /-->\n## Titre/);
    assert.match(annotated, /ligne\n<!--\//);
});

test('an opening marker with no closing one is reported, not dropped', () => {
    const [mention] = parseMentions('texte\n<!--ai:zz Corrige-->\nla suite\n');
    assert.equal(mention.unterminated, true);
    assert.equal(mention.prompt, 'Corrige');
    assert.equal(mention.text, '');
});

test('several mentions in one document keep their order and their ids', () => {
    const source = '<!--ai:one A-->x<!--/ai:one-->\n\n<!--ai:two B-->y<!--/ai:two-->\n';
    assert.deepEqual(
        parseMentions(source).map(mention => [mention.id, mention.prompt, mention.text]),
        [
            ['one', 'A', 'x'],
            ['two', 'B', 'y'],
        ]
    );
    assert.equal(removeAllMentions(source), 'x\n\ny\n');
});

test('an instruction cannot terminate its own comment', () => {
    // Otherwise "--> oops" would close the marker early and swallow the passage.
    const { source } = insertMention('texte', 0, 5, 'ferme ceci --> maintenant');
    const [mention] = parseMentions(source);
    assert.equal(mention.text, 'texte');
    assert.equal(mention.prompt, 'ferme ceci --→ maintenant');
    assert.equal(sanitizePrompt('a\nb'), 'a b');
});

test('a second mention in the same document gets its own id', () => {
    const first = insertMention('aaaa\n\nbbbb\n', 0, 4, 'x');
    const second = insertMention(first.source, first.source.indexOf('bbbb'), first.source.indexOf('bbbb') + 4, 'y');

    const mentions = parseMentions(second.source);
    assert.equal(mentions.length, 2);
    assert.notEqual(mentions[0].id, mentions[1].id);
    assert.deepEqual(mentions.map(mention => mention.text), ['aaaa', 'bbbb']);
});

test('generated ids do not collide with the ones already taken', () => {
    const taken = [];
    for (let round = 0; round < 200; round++) {
        const id = newMentionId(taken);
        assert.equal(taken.includes(id), false);
        taken.push(id);
    }
});

test('a selection that swallows its trailing newline still wraps cleanly', () => {
    // What a triple-click gives you: "ligne\n", newline included.
    const source = 'avant\nligne\napres\n';
    const from = source.indexOf('ligne');
    const { source: annotated } = insertMention(source, from, from + 'ligne\n'.length, 'Corrige');
    assert.match(annotated, /ligne<!--\/ai:[a-z0-9]+-->\napres/);
});

// --- collecting across a tree ------------------------------------------------

test('a mention is reported once, even in the root index page', async () => {
    // The root's index.md is both the tree's landing page and a file of the
    // tree; counting it from both places listed its mentions twice.
    const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const { collectMentions } = await import('../src/collect.mjs');

    const root = mkdtempSync(path.join(os.tmpdir(), 'md-collect-'));
    mkdirSync(path.join(root, 'guide'));
    writeFileSync(path.join(root, 'index.md'), '# Accueil\n\n<!--ai:a1 Reformule-->texte<!--/ai:a1-->\n');
    writeFileSync(path.join(root, 'guide/index.md'), '# Guide\n\n<!--ai:b2 Résume-->autre<!--/ai:b2-->\n');

    const mentions = await collectMentions(root);
    assert.deepEqual(
        mentions.map(mention => `${mention.file}:${mention.id}`).sort(),
        ['guide/index.md:b2', 'index.md:a1']
    );
});
