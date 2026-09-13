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

// --- saving over someone else's work ----------------------------------------
//
// The case: an agent applies the mentions of a file this editor has open with
// unsaved edits. Whoever writes last would win silently — so the write is
// refused, and both versions come back for the browser to choose from.

test('a save is refused when the file moved since it was read', async () => {
    writeFileSync(path.join(root, 'race.md'), '# Avant\n');
    const opened = await (await call('/api/file?path=race.md')).json();

    // Something else rewrites it (an agent, a git pull, another tab).
    await new Promise(resolve => setTimeout(resolve, 10));
    writeFileSync(path.join(root, 'race.md'), '# Écrit par quelqu’un d’autre\n');

    const refused = await call(`/api/file?path=race.md&mtime=${opened.mtime}`, {
        method: 'PUT',
        body: '# Ma version\n',
    });
    assert.equal(refused.status, 409);

    const payload = await refused.json();
    assert.equal(payload.conflict, true);
    assert.match(payload.source, /quelqu’un d’autre/, 'the current content comes back with the refusal');
    assert.match(readFileSync(path.join(root, 'race.md'), 'utf8'), /quelqu’un d’autre/, 'nothing was overwritten');

    // Saving against the mtime it reported goes through: that is how the
    // browser says "I have seen theirs, keep mine".
    const accepted = await call(`/api/file?path=race.md&mtime=${payload.mtime}`, {
        method: 'PUT',
        body: '# Ma version\n',
    });
    assert.equal(accepted.status, 200);
    assert.equal(readFileSync(path.join(root, 'race.md'), 'utf8'), '# Ma version\n');
});

test('a save with no mtime is taken as written — scripts have no buffer to lose', async () => {
    writeFileSync(path.join(root, 'script.md'), '# A\n');
    const response = await call('/api/file?path=script.md', { method: 'PUT', body: '# B\n' });
    assert.equal(response.status, 200);
    assert.equal(readFileSync(path.join(root, 'script.md'), 'utf8'), '# B\n');
});

test('the event stream reports a file changing under the editor', async () => {
    const response = await call('/api/events');
    assert.equal(response.headers.get('content-type'), 'text/event-stream; charset=utf-8');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    // Give the watcher a moment to attach before touching the tree.
    await new Promise(resolve => setTimeout(resolve, 150));
    writeFileSync(path.join(root, 'watched.md'), '# Watched\n');

    const deadline = Date.now() + 5000;
    let seen = '';
    while (Date.now() < deadline && !seen.includes('watched.md')) {
        const { value, done } = await reader.read();
        if (done) break;
        seen += decoder.decode(value, { stream: true });
    }
    await reader.cancel();

    assert.match(seen, /watched\.md/, 'the changed path reaches the browser');
});

// --- teaching the agents, from the web UI ------------------------------------

test('agent status reports our section, not merely a file called AGENTS.md', async () => {
    writeFileSync(path.join(root, 'AGENTS.md'), '# Le projet\n\nRègle maison.\n');
    const before = await (await call('/api/agent-status')).json();
    assert.equal(before.codex, false, 'a project’s own AGENTS.md is not our contract');
    assert.equal(before.claude, false);

    const installed = await (await call('/api/init-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claude: true, codex: true }),
    })).json();
    assert.deepEqual(
        installed.report.map(entry => entry.action).sort(),
        ['appended', 'written']
    );

    const after = await (await call('/api/agent-status')).json();
    assert.equal(after.claude, true);
    assert.equal(after.codex, true);

    const agents = readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
    assert.match(agents, /Règle maison/, 'what the project wrote stays');
    assert.match(agents, /## Mentions in the markdown/);
    assert.match(readFileSync(path.join(root, '.claude/commands/mentions.md'), 'utf8'), /\$ARGUMENTS/);
});

test('installing twice changes nothing', async () => {
    const again = await (await call('/api/init-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
    })).json();
    assert.deepEqual(again.report.map(entry => entry.action), ['kept', 'kept']);
    assert.equal(readFileSync(path.join(root, 'AGENTS.md'), 'utf8').match(/## Mentions in the markdown/g).length, 1);
});
