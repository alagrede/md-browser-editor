// Images pasted into a document, written next to it.
//
// The one write this server makes that is not markdown, so it is narrow on
// purpose: the bytes must BE a raster image (sniffed, not trusted from a
// header or a name), the file name is the server's, and nothing is ever
// overwritten. SVG is refused — it is a document that can carry script, and
// it would be served from the same origin as an editor that writes files.
import { existsSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const ASSETS_DIR = 'assets';

const startsWith = (bytes, signature, offset = 0) =>
    bytes.length >= offset + signature.length && signature.every((byte, index) => bytes[offset + index] === byte);

/** The extension a buffer's magic bytes say it is, or null if it is not an image we accept. */
export function imageExtension(bytes) {
    if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return '.png';
    if (startsWith(bytes, [0xff, 0xd8, 0xff])) return '.jpg';
    if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return '.gif'; // GIF8
    if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return '.webp';
    return null;
}

const isDirectory = file => existsSync(file) && statSync(file).isDirectory();

/**
 * Where an image pasted into `documentFile` goes: the nearest `assets/` from
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
 * A file name from what the clipboard called the image. A screenshot is
 * always "image.png", which says nothing — that one gets the time instead.
 */
export function assetBaseName(suggested, now = new Date()) {
    const stem = String(suggested ?? '')
        .replace(/\.[^.]*$/, '')
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^[-_]+|[-_]+$/g, '')
        .slice(0, 60);
    if (stem && stem !== 'image') return stem;
    const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    return `image-${date}-${time}`;
}

/**
 * Writes `bytes` as an image for the document at `documentFile`.
 *
 * @returns {Promise<{file: string, reference: string}|null>} the absolute file
 *   written and the path to write in the document (relative to it, "/"-joined),
 *   or null when the bytes are not an accepted image
 */
export async function saveImage(root, documentFile, bytes, suggested, now = new Date()) {
    const extension = imageExtension(bytes);
    if (!extension) return null;

    const dir = assetsDirFor(root, documentFile);
    await mkdir(dir, { recursive: true });
    const base = assetBaseName(suggested, now);

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
        return { file, reference };
    }
}
