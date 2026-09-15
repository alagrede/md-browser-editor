// Where a pasted file lands and what it is called. The server's rules for
// the one non-markdown write it makes.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assetFileName, assetsDirFor, saveAsset, sniffExtension } from '../src/assets.mjs';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const tree = () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'md-assets-'));
    mkdirSync(path.join(root, 'guide/deep'), { recursive: true });
    writeFileSync(path.join(root, 'guide/deep/page.md'), '# Page\n');
    return root;
};

test('an image or a PDF is recognised by its bytes', () => {
    assert.equal(sniffExtension(PNG), '.png');
    assert.equal(sniffExtension(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), '.jpg');
    assert.equal(sniffExtension(Buffer.from('GIF89a')), '.gif');
    assert.equal(sniffExtension(Buffer.from('RIFF\0\0\0\0WEBPVP8 ')), '.webp');
    assert.equal(sniffExtension(Buffer.from('%PDF-1.7\n')), '.pdf');
    assert.equal(sniffExtension(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), null);
    assert.equal(sniffExtension(Buffer.from('RIFF\0\0\0\0WAVE')), null);
    assert.equal(sniffExtension(Buffer.alloc(0)), null);
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
    const name = (suggested, bytes = Buffer.alloc(0)) => {
        const { base, extension, kind } = assetFileName(suggested, bytes, now);
        return [base + extension, kind];
    };
    assert.deepEqual(name('image.png', PNG), ['image-20260915-090507.png', 'image']);
    assert.deepEqual(name('', PNG), ['image-20260915-090507.png', 'image']);
    assert.deepEqual(name(undefined), ['file-20260915-090507', 'file']);
    assert.deepEqual(name('Schéma réseau (v2).PNG', PNG), ['schema-reseau-v2.png', 'image']);
    assert.deepEqual(name('Budget 2026.XLSX'), ['budget-2026.xlsx', 'file']);
    assert.deepEqual(name('logo.svg'), ['logo.svg', 'image']);
});

test('the bytes decide the extension when they can, the name when they cannot', () => {
    const now = new Date(2026, 8, 15, 9, 5, 7);
    assert.equal(assetFileName('capture.pdf', PNG, now).extension, '.png');
    assert.equal(assetFileName('photo.JPEG', Buffer.from([0xff, 0xd8, 0xff]), now).extension, '.jpg');
    assert.equal(assetFileName('notes', Buffer.from('hello'), now).extension, '');
});

test('nothing of a path or a dotfile survives in a name', () => {
    const now = new Date(2026, 8, 15, 9, 5, 7);
    const full = suggested => {
        const { base, extension } = assetFileName(suggested, Buffer.from('x'), now);
        return base + extension;
    };
    assert.equal(full('../../.env'), 'file-20260915-090507.env');
    assert.equal(full('..\\..\\evil.sh'), 'evil.sh');
    assert.equal(full('.bashrc'), 'file-20260915-090507.bashrc');
    assert.equal(full('a.tar.gz'), 'a-tar.gz');
});

test('saving writes the bytes, never over a file, and says how to reference them', async () => {
    const root = tree();
    const page = path.join(root, 'guide/deep/page.md');
    mkdirSync(path.join(root, 'assets'));

    const first = await saveAsset(root, page, PNG, 'diagram.png');
    const second = await saveAsset(root, page, PNG, 'diagram.png');
    assert.equal(first.reference, '../../assets/diagram.png');
    assert.equal(first.kind, 'image');
    assert.equal(second.reference, '../../assets/diagram-2.png');
    assert.deepEqual(readdirSync(path.join(root, 'assets')).sort(), ['diagram-2.png', 'diagram.png']);


    const pdf = await saveAsset(root, page, Buffer.from('%PDF-1.4\n'), 'Cerfa 12669.pdf');
    assert.deepEqual([pdf.reference, pdf.kind], ['../../assets/cerfa-12669.pdf', 'file']);
});
