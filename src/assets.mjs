// Files pasted into a document, written next to it.
//
// The one write this server makes that is not markdown, so its rules are its
// own: the request names the document, never a destination; the file lands in
// an assets/ folder under a name the server builds (no path, no dotfile); and
// nothing is ever overwritten. Any kind of file is accepted — what keeps that
// safe is on the READ side: only the allowlist in paths.mjs is ever served,
// SVG in a sandbox, so a pasted .html is a file on disk, never a page of this
// origin.
import { existsSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const ASSETS_DIR = 'assets';

/** What the editor displays inline; everything else becomes a link. */
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.bmp', '.svg']);

const startsWith = (bytes, signature, offset = 0) =>
    bytes.length >= offset + signature.length && signature.every((byte, index) => bytes[offset + index] === byte);

/**
 * The extension a buffer's magic bytes say it is, or null when they say
 * nothing we know. Sniffed bytes beat a name: a screenshot saved as
 * "capture.pdf" by some tool is still a PNG.
 */
export function sniffExtension(bytes) {
    if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return '.png';
    if (startsWith(bytes, [0xff, 0xd8, 0xff])) return '.jpg';
    if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return '.gif'; // GIF8
    if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return '.webp';
    if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return '.pdf'; // %PDF-
    return null;
}

const isDirectory = file => existsSync(file) && statSync(file).isDirectory();

/**
 * Where a file pasted into `documentFile` goes: the nearest `assets/` from
 * the document's folder up to the root, so a tree with one shared folder keeps
 * using it; a document with none above it gets its own, next to it — which is
 * what a relative `assets/…` reference already means to the editor.
 */
export function assetsDirFor(root, documentFile) {
    const home = path.dirname(documentFile);
    for (let dir = home; ; dir = path.dirname(dir)) {
        if (isDirectory(path.join(dir, ASSETS_DIR))) return path.join(dir, ASSETS_DIR);
        if (dir === root || path.relative(root, dir).startsWith('..') || dir === path.dirname(dir)) break;
    }
    return path.join(home, ASSETS_DIR);
}

const pad = number => String(number).padStart(2, '0');

/**
 * The name a pasted file is saved under, as {base, extension, kind}.
 *
 * The stem comes from what the clipboard called the file, reduced to
 * [a-z0-9_-] so that nothing of a path or a dotfile survives. A screenshot is
 * always "image.png", which says nothing — that one, like a file with no
 * usable name, is named by the time instead.
 */
export function assetFileName(suggested, bytes, now = new Date()) {
    const name = String(suggested ?? '');
    const named = /\.([a-z0-9]{1,10})$/i.exec(name);
    const extension = sniffExtension(bytes) ?? (named ? `.${named[1].toLowerCase()}` : '');
    const kind = IMAGE_EXTENSIONS.has(extension) ? 'image' : 'file';

    const stem = (named ? name.slice(0, -named[0].length) : name)
        .normalize('NFKD')
        .replace(/\p{M}/gu, '')
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^[-_]+|[-_]+$/g, '')
        .slice(0, 60);
    if (stem && stem !== 'image') return { base: stem, extension, kind };

    const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    return { base: `${kind === 'image' ? 'image' : 'file'}-${date}-${time}`, extension, kind };
}

/**
 * Writes `bytes` as an asset of the document at `documentFile`.
 *
 * @returns {Promise<{file: string, reference: string, kind: 'image'|'file'}>}
 *   the absolute file written, the path to write in the document (relative to
 *   it, "/"-joined), and whether the editor shows it or links to it
 */
export async function saveAsset(root, documentFile, bytes, suggested, now = new Date()) {
    const { base, extension, kind } = assetFileName(suggested, bytes, now);
    const dir = assetsDirFor(root, documentFile);
    await mkdir(dir, { recursive: true });

    // 'wx' fails on an existing file, so two pastes racing for one name cannot
    // both win: the loser takes the next suffix.
    for (let attempt = 1; ; attempt++) {
        const file = path.join(dir, `${attempt === 1 ? base : `${base}-${attempt}`}${extension}`);
        try {
            await writeFile(file, bytes, { flag: 'wx' });
        } catch (error) {
            if (error.code === 'EEXIST' && attempt < 1000) continue;
            throw error;
        }
        const reference = path
            .relative(path.dirname(documentFile), file)
            .split(path.sep)
            .map(segment => encodeURIComponent(segment))
            .join('/');
        return { file, reference, kind };
    }
}
