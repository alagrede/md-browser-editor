// The API, over a real socket: what the browser can do, and what it cannot.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
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

test('a document URL serves the editor, so a refresh lands back on it', async () => {
    const page = await call('/guide/page.md');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    assert.match(await page.text(), /<div id="app">/, 'the editor, not the raw markdown');

    // Even for a document that does not exist: the editor says so better than
    // a bare 404 page would.
    assert.equal((await call('/nulle-part.md')).status, 200);

    // But a path this server would never talk about stays refused, even though
    // only the static shell was ever on offer.
    assert.equal((await call('/.secrets/token.md')).status, 404);
    // Nothing about "/../" is tested here: both fetch and Node's URL parser
    // resolve it away before the server sees a path at all. The traversal that
    // CAN arrive comes through the ?path= parameter, which is not normalised by
    // anything — that is the case covered above.

    // And the raw text still has its own address.
    const raw = await (await call('/api/file?path=guide/page.md')).json();
    assert.match(raw.source, /# Page/);
});

// --- pasting a file ------------------------------------------------------------

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

test('a pasted image is written next to its document, with a reference relative to it', async () => {
    const response = await call('/api/asset?document=guide/page.md&name=Capture%20d%E2%80%99%C3%A9cran.png', {
        method: 'POST',
        body: PNG,
    });
    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(payload.reference, 'assets/capture-d-ecran.png');
    assert.equal(payload.path, 'guide/assets/capture-d-ecran.png');
    assert.deepEqual(readFileSync(path.join(root, 'guide/assets/capture-d-ecran.png')), PNG);

    const again = await (await call('/api/asset?document=guide/page.md&name=Capture%20d%E2%80%99%C3%A9cran.png', {
        method: 'POST',
        body: PNG,
    })).json();
    assert.equal(again.reference, 'assets/capture-d-ecran-2.png', 'never over an existing file');
});

test('any other file is written too, and linked rather than shown', async () => {
    const pdf = await (await call('/api/asset?document=guide/page.md&name=cerfa_12669-02.pdf', {
        method: 'POST',
        body: Buffer.from('%PDF-1.7\n%âãÏÓ\n'),
    })).json();
    assert.deepEqual([pdf.reference, pdf.kind], ['assets/cerfa_12669-02.pdf', 'file']);
    assert.equal((await call('/guide/assets/cerfa_12669-02.pdf')).headers.get('content-type'), 'application/pdf');

    const sheet = await (await call('/api/asset?document=guide/page.md&name=Budget%202026.xlsx', {
        method: 'POST',
        body: Buffer.from('PK\x03\x04 not really a spreadsheet'),
    })).json();
    assert.deepEqual([sheet.reference, sheet.kind], ['assets/budget-2026.xlsx', 'file']);
    assert.equal(existsSync(path.join(root, 'guide/assets/budget-2026.xlsx')), true);

    // Not on the allowlist, but an attachment: it downloads.
    const download = await call(`/guide/${sheet.reference}`);
    assert.equal(download.status, 200);
    assert.equal(download.headers.get('content-type'), 'application/octet-stream');
    assert.equal(download.headers.get('content-disposition'), "attachment; filename*=UTF-8''budget-2026.xlsx");
    assert.match(await download.text(), /not really a spreadsheet/);
});

test('outside assets/, a type off the allowlist is still refused, and so is a rebinding download', async () => {
    writeFileSync(path.join(root, 'guide/server.key'), 'PRIVATE');
    assert.equal((await call('/guide/server.key')).status, 404);

    mkdirSync(path.join(root, 'assets'), { recursive: true });
    writeFileSync(path.join(root, 'assets/notes.docx'), 'docx');
    assert.equal(await raw('/assets/notes.docx', { method: 'GET' }), 200);
    assert.equal(await raw('/assets/notes.docx', { method: 'GET', headers: { Host: 'rebind.evil.example:4899' } }), 404);
});

test('a pasted file is written, but never served as a page of the editor', async () => {
    const html = await (await call('/api/asset?document=guide/page.md&name=evil.html', {
        method: 'POST',
        body: '<script>fetch("/api/file?path=README.md", { method: "PUT", body: "pwned" })</script>',
    })).json();
    const page = await call(`/guide/${html.reference}`);
    assert.equal(page.headers.get('content-type'), 'application/octet-stream', 'a download, never a page');
    assert.match(page.headers.get('content-disposition'), /^attachment;/);
    assert.equal(page.headers.get('x-content-type-options'), 'nosniff');

    const svg = await (await call('/api/asset?document=guide/page.md&name=x.svg', {
        method: 'POST',
        body: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    })).json();
    assert.equal(svg.kind, 'image');
    const served = await call(`/guide/${svg.reference}`);
    assert.equal(served.headers.get('content-security-policy'), 'sandbox', 'an SVG runs no script on this origin');

    const disguised = await (await call('/api/asset?document=guide/page.md&name=shot.png', { method: 'POST', body: '<html>' })).json();
    assert.equal((await call(`/guide/${disguised.reference}`)).headers.get('x-content-type-options'), 'nosniff');
});

test('a paste refuses an empty body, and any destination but a document', async () => {
    const empty = await call('/api/asset?document=guide/page.md&name=folder', { method: 'POST', body: '' });
    assert.equal(empty.status, 400);

    for (const document of ['../../etc/passwd', '.secrets/token.md', 'guide/assets/x.png', 'nowhere.md']) {
        const refused = await call(`/api/asset?document=${encodeURIComponent(document)}`, { method: 'POST', body: PNG });
        assert.ok([403, 404].includes(refused.status), `document=${document}`);
    }
});

// --- writes from another site ---------------------------------------------------

/** A raw request, so Origin and Host can be what another site would send. */
const raw = (route, { method = 'POST', headers = {}, body = '' } = {}) =>
    new Promise((resolve, reject) => {
        const target = new URL(route, server.url);
        const request = http.request(
            { host: target.hostname, port: target.port, path: target.pathname + target.search, method, headers },
            response => {
                response.resume();
                response.on('end', () => resolve(response.statusCode));
            }
        );
        request.on('error', reject);
        request.end(body);
    });

test('a write from another site is refused, a write from the editor or a script is not', async () => {
    const own = new URL(server.url).host;
    const route = '/api/asset?document=guide/page.md&name=csrf.txt';

    assert.equal(await raw(route, { headers: { Origin: 'https://evil.example' }, body: 'x' }), 403, 'another site');
    assert.equal(await raw(route, { headers: { Origin: 'null' }, body: 'x' }), 403, 'a sandboxed page or a file://');
    assert.equal(
        await raw(route, { headers: { Host: 'rebind.evil.example:4899', Origin: 'http://rebind.evil.example:4899' }, body: 'x' }),
        403,
        'DNS rebinding: Origin and Host agree, but the name is not local'
    );
    assert.equal(await raw('/api/file?path=README.md', { method: 'PUT', headers: { Origin: 'https://evil.example' }, body: 'x' }), 403);
    assert.match(readFileSync(path.join(root, 'README.md'), 'utf8'), /# Root/, 'nothing was written');

    assert.equal(await raw(route, { headers: { Origin: `http://${own}` }, body: 'x' }), 201, 'the editor');
    assert.equal(await raw(route, { body: 'x' }), 201, 'curl, a script: no Origin at all');
    assert.equal(await raw(route, { headers: { Host: `localhost:${new URL(server.url).port}` }, body: 'x' }), 201);
});
