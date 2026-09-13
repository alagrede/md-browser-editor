// The API, over a real socket: what the browser can do, and what it cannot.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { startServer } from '../src/server/server.mjs';

let root;
let server;
const call = (route, init) => fetch(new URL(route, server.url), init);

before(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), 'md-editor-'));
    mkdirSync(path.join(root, 'guide'));
    mkdirSync(path.join(root, '.secrets'));
    writeFileSync(path.join(root, 'README.md'), '# Root\n');
    writeFileSync(path.join(root, 'guide/page.md'), '# Page\n\n<!--ai:k1 Reformule-->texte<!--/ai:k1-->\n');
    writeFileSync(path.join(root, '.secrets/token.md'), 'sensitive\n');
    writeFileSync(path.join(root, 'notes.txt'), 'not markdown\n');
    server = await startServer({ root, port: 4899 });
});

after(() => server.close());

test('the tree lists markdown and hides dotted directories', async () => {
    const { tree } = await (await call('/api/tree')).json();
    const names = tree.map(node => node.name);
    assert.deepEqual(names, ['guide', 'README.md']);
    assert.equal(tree[0].children[0].path, 'guide/page.md');
});

test('a file reads back with its source', async () => {
    const payload = await (await call('/api/file?path=guide/page.md')).json();
    assert.match(payload.source, /# Page/);
});

test('saving writes the file and keeps exactly one trailing newline', async () => {
    const response = await call('/api/file?path=README.md', { method: 'PUT', body: '# Root\n\nAjout.\n\n\n' });
    assert.equal(response.status, 200);
    assert.equal(readFileSync(path.join(root, 'README.md'), 'utf8'), '# Root\n\nAjout.\n');
});

test('creating refuses to overwrite', async () => {
    const created = await call('/api/file?path=notes/new.md', { method: 'POST', body: '# New\n' });
    assert.equal(created.status, 201);
    assert.equal(existsSync(path.join(root, 'notes/new.md')), true);

    const again = await call('/api/file?path=notes/new.md', { method: 'POST', body: '# Other\n' });
    assert.equal(again.status, 409);
    assert.match(readFileSync(path.join(root, 'notes/new.md'), 'utf8'), /# New/);
});

test('mentions are collected across the tree', async () => {
    const { mentions } = await (await call('/api/mentions')).json();
    assert.equal(mentions.length, 1);
    assert.equal(mentions[0].file, 'guide/page.md');
    assert.equal(mentions[0].prompt, 'Reformule');
    assert.equal(mentions[0].text, 'texte');
});

test('resolving a mention drops the markers and keeps the text', async () => {
    const response = await call('/api/mention?path=guide/page.md&id=k1', { method: 'DELETE' });
    assert.equal(response.status, 200);
    const onDisk = readFileSync(path.join(root, 'guide/page.md'), 'utf8');
    assert.equal(onDisk.includes('<!--ai:'), false);
    assert.match(onDisk, /texte/);
});

test('reads and writes outside the root are refused', async () => {
    for (const target of ['../../etc/passwd', '/.secrets/token.md', '/guide/../../escape.md']) {
        const read = await call(`/api/file?path=${encodeURIComponent(target)}`);
        assert.equal(read.status, 403, `GET ${target}`);
        const write = await call(`/api/file?path=${encodeURIComponent(target)}`, { method: 'PUT', body: 'x' });
        assert.equal(write.status, 403, `PUT ${target}`);
    }
});

test('writing anything but markdown is refused', async () => {
    const response = await call('/api/file?path=payload.js', { method: 'POST', body: 'alert(1)' });
    assert.equal(response.status, 403);
    assert.equal(existsSync(path.join(root, 'payload.js')), false);
});

test('assets are served from an allowlist, other types are not', async () => {
    writeFileSync(path.join(root, 'shot.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const image = await call('/shot.png');
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/png');

    writeFileSync(path.join(root, 'script.js'), 'alert(1)');
    assert.equal((await call('/script.js')).status, 404);
    assert.equal((await call('/.secrets/token.md')).status, 404);
});
