// Where a pasted image lands and what it is called. The server's rules for
// the one non-markdown write it makes.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assetBaseName, assetsDirFor, imageExtension, saveImage } from '../src/assets.mjs';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const tree = () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'md-assets-'));
    mkdirSync(path.join(root, 'guide/deep'), { recursive: true });
    writeFileSync(path.join(root, 'guide/deep/page.md'), '# Page\n');
    return root;
};

test('an image is recognised by its bytes, not its name', () => {
    assert.equal(imageExtension(PNG), '.png');
    assert.equal(imageExtension(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), '.jpg');
    assert.equal(imageExtension(Buffer.from('GIF89a')), '.gif');
    assert.equal(imageExtension(Buffer.from('RIFF\0\0\0\0WEBPVP8 ')), '.webp');
    assert.equal(imageExtension(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), null);
    assert.equal(imageExtension(Buffer.from('RIFF\0\0\0\0WAVE')), null);
    assert.equal(imageExtension(Buffer.alloc(0)), null);
});

test('a document with no assets folder above it gets its own', () => {
    const root = tree();
    const page = path.join(root, 'guide/deep/page.md');
    assert.equal(assetsDirFor(root, page), path.join(root, 'guide/deep/assets'));
});

test('the nearest existing assets folder is used, up to the root and no further', () => {
    const root = tree();
    const page = path.join(root, 'guide/deep/page.md');
    mkdirSync(path.join(root, 'assets'));
    assert.equal(assetsDirFor(root, page), path.join(root, 'assets'));
    mkdirSync(path.join(root, 'guide/assets'));
    assert.equal(assetsDirFor(root, page), path.join(root, 'guide/assets'));

    // Serving guide/deep alone: the assets/ folders above it are not this tree's.
    const served = path.join(root, 'guide/deep');
    assert.equal(assetsDirFor(served, page), path.join(served, 'assets'));
});

test('a screenshot is named by the time, anything else by its own name', () => {
    const now = new Date(2026, 8, 15, 9, 5, 7);
    assert.equal(assetBaseName('image.png', now), 'image-20260915-090507');
    assert.equal(assetBaseName('', now), 'image-20260915-090507');
    assert.equal(assetBaseName(undefined, now), 'image-20260915-090507');
    assert.equal(assetBaseName('Schéma réseau (v2).PNG', now), 'schema-reseau-v2');
    assert.equal(assetBaseName('../../.env', now), 'image-20260915-090507', 'nothing of a path survives');
});

test('saving writes the bytes, never over a file, and says how to reference them', async () => {
    const root = tree();
    const page = path.join(root, 'guide/deep/page.md');
    mkdirSync(path.join(root, 'assets'));

    const first = await saveImage(root, page, PNG, 'diagram.png');
    const second = await saveImage(root, page, PNG, 'diagram.png');
    assert.equal(first.reference, '../../assets/diagram.png');
    assert.equal(second.reference, '../../assets/diagram-2.png');
    assert.deepEqual(readdirSync(path.join(root, 'assets')).sort(), ['diagram-2.png', 'diagram.png']);

    assert.equal(await saveImage(root, page, Buffer.from('not an image'), 'x.png'), null);
});
