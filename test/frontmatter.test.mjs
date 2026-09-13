// Frontmatter is the one block a markdown parser gets actively wrong:
// `title: Guide` followed by `---` is a setext heading. Finding it exactly is
// what keeps it out of the renderer's hands.
import assert from 'node:assert/strict';
import test from 'node:test';
import { documentTitle, findFrontmatter, frontmatterOf, parseFrontmatter, stripFrontmatter } from '../src/frontmatter.mjs';

const DOC = ['---', 'title: Guide', 'draft: false', '---', '', '# Guide', '', 'Texte.', ''].join('\n');

test('a block at the top is found, with its exact range', () => {
    const block = findFrontmatter(DOC);
    assert.equal(block.from, 0);
    assert.equal(DOC.slice(block.from, block.to), '---\ntitle: Guide\ndraft: false\n---');
    assert.equal(block.body, 'title: Guide\ndraft: false');
    assert.equal(stripFrontmatter(DOC), '# Guide\n\nTexte.\n');
});

test('what is not a block at the very top is not a block', () => {
    assert.equal(findFrontmatter('# Titre\n\n---\ntitle: x\n---\n'), null, 'a rule further down');
    assert.equal(findFrontmatter('---\ntitle: x\n'), null, 'no closing fence');
    assert.equal(findFrontmatter('----\ntitle: x\n----\n'), null, 'four dashes is a rule');
    assert.equal(findFrontmatter(''), null);
});

test('a horizontal rule right under a block is not mistaken for its fence', () => {
    const source = '---\ntitle: x\n---\n\n---\n\nTexte.\n';
    assert.equal(findFrontmatter(source).body, 'title: x');
});

test('scalars, quotes, inline lists and block lists all parse', () => {
    const body = [
        'title: "Un: deux"',
        "author: 'O''Neil'",
        'tags: [docs, guide]',
        'authors:',
        '  - alice',
        '  - bob',
        '# a comment',
        'draft: false',
    ].join('\n');

    assert.deepEqual(parseFrontmatter(body), [
        { key: 'title', value: 'Un: deux', nested: false },
        { key: 'author', value: "O'Neil", nested: false },
        { key: 'tags', value: ['docs', 'guide'], nested: false },
        { key: 'authors', value: ['alice', 'bob'], nested: false },
        { key: 'draft', value: 'false', nested: false },
    ]);
});

test('a shape the subset does not model is flagged, not guessed', () => {
    const [property] = parseFrontmatter('deploy:\n  host: example.com\n  port: 443');
    assert.equal(property.key, 'deploy');
    assert.equal(property.nested, true, 'the editor shows those raw instead of inventing a value');
});

test('the title comes from the frontmatter, then the first heading', () => {
    assert.equal(documentTitle(DOC), 'Guide');
    assert.equal(documentTitle('---\ntitle: Propre\n---\n\n# Autre\n'), 'Propre');
    assert.equal(documentTitle('# Juste un titre\n\ntexte\n'), 'Juste un titre');
    assert.equal(documentTitle('## Pas de niveau 1\n'), null);
    // A heading that follows prose names a section, not the document.
    assert.equal(documentTitle('Une intro.\n\n# Section\n'), null);
    assert.equal(documentTitle(''), null);
    assert.deepEqual(frontmatterOf('no frontmatter here'), {});
});
