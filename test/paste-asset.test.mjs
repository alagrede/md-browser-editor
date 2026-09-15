// What a paste turns into: text, files to upload, or a refusal to explain.
import assert from 'node:assert/strict';
import test from 'node:test';
import { assetMarkdown, filesToUpload } from '../client/paste-asset.js';

/** The part of a DataTransfer the paste handler reads. */
const clipboard = ({ text = '', files = [] }) => ({
    files,
    getData: type => (type === 'text/plain' ? text : ''),
});
const file = (name, type, size = 10) => ({ name, type, size });

test('a screenshot, with no text, is uploaded', () => {
    const png = file('image.png', 'image/png');
    assert.deepEqual(filesToUpload(clipboard({ files: [png] })), { accepted: [png], refused: [] });
});

test('a file copied in the Finder comes with its name as text, and is still a file', () => {
    const pdf = file('cerfa_12669-02-principale.pdf', 'application/pdf');
    const result = filesToUpload(clipboard({ text: 'cerfa_12669-02-principale.pdf', files: [pdf] }));
    assert.deepEqual(result.accepted, [pdf]);

    const png = file('b.png', 'image/png');
    assert.deepEqual(filesToUpload(clipboard({ text: 'cerfa_12669-02-principale.pdf\rb.png', files: [pdf, png] })).accepted, [pdf, png]);
});

test('text that is not just the file names wins: spreadsheet cells carry a picture of themselves', () => {
    const png = file('image.png', 'image/png');
    assert.deepEqual(filesToUpload(clipboard({ text: 'A1\tB1', files: [png] })), { accepted: [], refused: [] });
    assert.deepEqual(filesToUpload(clipboard({ text: 'plain text' })), { accepted: [], refused: [] });
});

test('any kind of file is uploaded; a folder is reported, not silently dropped', () => {
    const zip = file('archive.zip', 'application/zip');
    const unknown = file('data.bin', '');
    assert.deepEqual(filesToUpload(clipboard({ files: [zip, unknown] })).accepted, [zip, unknown]);

    const folder = file('Photos', '', 0);
    assert.deepEqual(filesToUpload(clipboard({ text: 'Photos', files: [folder] })), { accepted: [], refused: [folder] });
});

test('an image shows, any other file is a link named after it', () => {
    assert.equal(
        assetMarkdown([
            { reference: 'assets/shot.png', kind: 'image', name: 'image.png' },
            { reference: 'assets/cerfa.pdf', kind: 'file', name: 'Cerfa [v2].pdf' },
        ]),
        '![](assets/shot.png)\n[Cerfa \\[v2\\].pdf](assets/cerfa.pdf)'
    );
});
