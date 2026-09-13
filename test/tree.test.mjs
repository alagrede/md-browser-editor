import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildTree, flattenFiles, rootIndex } from '../src/tree.mjs';

test('the tree carries markdown, sorted, directories first', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'md-tree-'));
    mkdirSync(path.join(root, 'guide'));
    mkdirSync(path.join(root, 'images'));
    mkdirSync(path.join(root, 'node_modules'));
    mkdirSync(path.join(root, '.git'));
    writeFileSync(path.join(root, 'b.md'), '');
    writeFileSync(path.join(root, 'a.md'), '');
    writeFileSync(path.join(root, 'guide/page.md'), '');
    writeFileSync(path.join(root, 'images/shot.png'), '');
    writeFileSync(path.join(root, 'node_modules/readme.md'), '');
    writeFileSync(path.join(root, '.git/config.md'), '');

    const tree = await buildTree(root);

    assert.deepEqual(
        tree.map(node => `${node.type}:${node.name}`),
        ['dir:guide', 'file:a.md', 'file:b.md'],
        'images/ holds no markdown, node_modules and .git are never documentation'
    );
    assert.deepEqual(flattenFiles(tree), ['guide/page.md', 'a.md', 'b.md']);
});

test('a directory with an index.md becomes that page', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'md-index-'));
    mkdirSync(path.join(root, 'guide'));
    mkdirSync(path.join(root, 'guide/deep'));
    mkdirSync(path.join(root, 'solo'));
    writeFileSync(path.join(root, 'index.md'), '# Root');
    writeFileSync(path.join(root, 'guide/index.md'), '# Guide');
    writeFileSync(path.join(root, 'guide/page.md'), '# Page');
    writeFileSync(path.join(root, 'guide/deep/index.md'), '# Deep');
    writeFileSync(path.join(root, 'solo/index.md'), '# Solo');

    const tree = await buildTree(root);
    const guide = tree.find(node => node.name === 'guide');

    assert.equal(guide.index, 'guide/index.md');
    assert.deepEqual(
        guide.children.map(node => node.name),
        ['deep', 'page.md'],
        'the index took the folder row, so it is not listed inside it too'
    );
    assert.equal(guide.children[0].index, 'guide/deep/index.md', 'nesting works');

    // A folder whose only markdown is its index is a page, not an empty folder.
    assert.equal(tree.find(node => node.name === 'solo').index, 'solo/index.md');

    // The root has no folder row to take, so its index stays a file — and the
    // sidebar header opens it instead.
    assert.equal(tree.find(node => node.name === 'index.md').type, 'file');
    assert.equal(await rootIndex(root), 'index.md');

    // Every page must stay reachable: index pages carry mentions too.
    assert.deepEqual(flattenFiles(tree), [
        'guide/index.md',
        'guide/deep/index.md',
        'guide/page.md',
        'solo/index.md',
        'index.md',
    ]);
});

test('a directory without an index keeps its plain folder behaviour', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'md-noindex-'));
    mkdirSync(path.join(root, 'notes'));
    writeFileSync(path.join(root, 'notes/one.md'), '');

    const [folder] = await buildTree(root);
    assert.equal(folder.index, undefined);
    assert.equal(await rootIndex(root), undefined);
});

test('the tree names a document by its title, not its file name', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'md-title-'));
    mkdirSync(path.join(root, 'guide'));
    writeFileSync(path.join(root, 'guide/index.md'), '---\ntitle: Guide utilisateur\n---\n\n# Autre\n');
    writeFileSync(path.join(root, 'guide/02-setup.md'), '# Installation\n');
    writeFileSync(path.join(root, 'guide/03-plain.md'), 'du texte sans titre\n');

    const [folder] = await buildTree(root);

    assert.equal(folder.title, 'Guide utilisateur', 'a folder is named by its index page');
    assert.deepEqual(
        folder.children.map(node => node.title ?? node.name),
        ['Installation', '03-plain.md'],
        'titles are displayed, but a document with no title keeps its file name'
    );
    // Ordering follows the FILE name: renaming to 01-, 02- is what an author
    // has left to order a tree whose file names are no longer shown.
    writeFileSync(path.join(root, 'guide/01-first.md'), '# Zzz dernier alphabétiquement\n');
    const [again] = await buildTree(root);
    assert.deepEqual(again.children.map(node => node.name), ['01-first.md', '02-setup.md', '03-plain.md']);
});
