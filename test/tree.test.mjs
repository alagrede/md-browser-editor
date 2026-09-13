import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildTree, flattenFiles } from '../src/tree.mjs';

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
