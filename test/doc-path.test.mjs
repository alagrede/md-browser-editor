// Where an image referenced from a document is actually served.
//
// The bug this covers: the page URL is "/" whatever document is open, so a
// browser resolves `assets/shot.png` against the ROOT. In a tree where several
// folders have their own assets/ — and the root has one too — that is a quiet
// wrong answer rather than a 404 you would notice.
import assert from 'node:assert/strict';
import test from 'node:test';
import { assetUrl, rootAssetUrl } from '../client/doc-path.js';

test('a relative path resolves against the document, not the root', () => {
    assert.equal(
        assetUrl('assets/image-1.png', 'liste-de-materiel/index.md'),
        '/liste-de-materiel/assets/image-1.png'
    );
    assert.equal(assetUrl('assets/planning/shot.png', 'planning.md'), '/assets/planning/shot.png');
    assert.equal(assetUrl('shot.png', 'a/b/c/page.md'), '/a/b/c/shot.png');
});

test('"./" and "../" are resolved', () => {
    assert.equal(assetUrl('./assets/shot.png', 'guide/page.md'), '/guide/assets/shot.png');
    assert.equal(assetUrl('../assets/shared.png', 'guide/page.md'), '/assets/shared.png');
    assert.equal(assetUrl('../../top.png', 'a/b/page.md'), '/top.png');
});

test('an already-encoded name is not encoded twice', () => {
    // encodeURI would make this %2520 — a request for a file whose name really
    // contains "%20".
    assert.equal(assetUrl('assets/photo%20x.png', 'guide/page.md'), '/guide/assets/photo%20x.png');
    // …and a name with a real space gets encoded once.
    assert.equal(assetUrl('assets/photo x.png', 'guide/page.md'), '/guide/assets/photo%20x.png');
});

test('a root-absolute path is kept, a URL is left to the browser', () => {
    assert.equal(assetUrl('/assets/shot.png', 'guide/page.md'), '/assets/shot.png');
    assert.equal(assetUrl('https://example.com/a.png', 'guide/page.md'), null);
    assert.equal(assetUrl('data:image/png;base64,AAA', 'guide/page.md'), null);
    assert.equal(assetUrl('//cdn.example.com/a.png', 'guide/page.md'), null);
    assert.equal(assetUrl('', 'guide/page.md'), null);
});

test('the root-relative fallback is what the other convention would ask for', () => {
    assert.equal(rootAssetUrl('assets/shot.png'), '/assets/shot.png');
    assert.equal(rootAssetUrl('/assets/shot.png'), '/assets/shot.png');
    assert.equal(rootAssetUrl('https://example.com/a.png'), null);
});
