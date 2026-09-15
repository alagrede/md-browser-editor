// The path rules are the security surface: this server writes.
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { attachment, markdownTarget, mimeFor, resolveInRoot } from '../src/paths.mjs';

const ROOT = path.resolve('/tmp/md-root');

test('an ordinary path resolves under the root', () => {
    assert.equal(resolveInRoot(ROOT, '/guide/page.md'), path.join(ROOT, 'guide/page.md'));
    assert.equal(resolveInRoot(ROOT, 'guide/page.md'), path.join(ROOT, 'guide/page.md'));
    assert.equal(resolveInRoot(ROOT, '/images/shot%20one.png'), path.join(ROOT, 'images/shot one.png'));
});

test('escaping the root is refused', () => {
    assert.equal(resolveInRoot(ROOT, '/../../etc/passwd'), null);
    assert.equal(resolveInRoot(ROOT, '/guide/../../outside.md'), null);
    assert.equal(resolveInRoot(ROOT, '/%2e%2e/%2e%2e/etc/passwd'), null);
});

test('dotted segments are refused whatever the root turns out to be', () => {
    assert.equal(resolveInRoot(ROOT, '/.env'), null);
    assert.equal(resolveInRoot(ROOT, '/.git/config'), null);
    assert.equal(resolveInRoot(ROOT, '/docs/.ssh/id_rsa'), null);
});

test('malformed encoding and NUL bytes are refused', () => {
    assert.equal(resolveInRoot(ROOT, '/%E0%A4%A'), null);
    assert.equal(resolveInRoot(ROOT, '/page%00.md'), null);
});

test('writes are markdown only', () => {
    assert.equal(markdownTarget(ROOT, '/notes/idea.md'), path.join(ROOT, 'notes/idea.md'));
    assert.equal(markdownTarget(ROOT, '/notes/idea.MD'), path.join(ROOT, 'notes/idea.MD'));
    // Anything the browser could later be made to run, or that is not a document.
    assert.equal(markdownTarget(ROOT, '/payload.js'), null);
    assert.equal(markdownTarget(ROOT, '/index.html'), null);
    assert.equal(markdownTarget(ROOT, '/run.command'), null);
    assert.equal(markdownTarget(ROOT, '/notes/idea'), null);
});

test('the mime table is an allowlist, not a fallback', () => {
    assert.equal(mimeFor('/x/a.png'), 'image/png');
    assert.equal(mimeFor('/x/a.PNG'), 'image/png');
    assert.equal(mimeFor('/x/a.key'), null);
    assert.equal(mimeFor('/x/a.js'), null);
    assert.equal(mimeFor('/x/binary'), null);
});

test('only a file inside an assets/ folder is an attachment', () => {
    assert.equal(attachment(ROOT, path.join(ROOT, 'assets/report.docx')), true);
    assert.equal(attachment(ROOT, path.join(ROOT, 'guide/assets/deep/archive.zip')), true);
    assert.equal(attachment(ROOT, path.join(ROOT, 'guide/report.docx')), false);
    assert.equal(attachment(ROOT, path.join(ROOT, 'assets.key')), false, 'a file called assets is not a folder');
    assert.equal(attachment(ROOT, path.join(ROOT, 'my-assets/server.key')), false);
});
