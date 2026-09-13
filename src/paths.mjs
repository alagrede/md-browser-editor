// Path and content-type decisions, kept out of the server so the
// security-relevant rules are directly testable.
//
// This server both reads AND writes, so the rules matter more than in a
// read-only preview: every path the browser sends goes through resolveInRoot,
// and writes additionally go through markdownTarget.
import path from 'node:path';

/**
 * Content types served as-is. An allowlist, not a lookup with a fallback: an
 * unknown extension under the root is not a documentation asset, and streaming
 * it as octet-stream would hand out whatever it happens to be — a .env, a key,
 * a source file.
 */
export const MIME = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.bmp': 'image/bmp',
    '.ico': 'image/x-icon',
    '.pdf': 'application/pdf',
    '.json': 'application/json',
    '.txt': 'text/plain; charset=utf-8',
    '.csv': 'text/csv; charset=utf-8',
};

/** Content type for a file the allowlist covers, else null. */
export function mimeFor(file) {
    return MIME[path.extname(file).toLowerCase()] ?? null;
}

/**
 * Resolves a browser-supplied path to an absolute path under `root`.
 *
 * @returns {string|null} the absolute path, or null when the request must be
 *   refused: malformed encoding, a NUL byte, an escape from the root, or a
 *   dotted path segment. Dotted segments are never documentation, and refusing
 *   them keeps `.env`, `.git/` and `.ssh/` out of reach whatever the root is.
 */
export function resolveInRoot(root, requested) {
    let decoded;
    try {
        decoded = decodeURIComponent(String(requested ?? '').split('?')[0]);
    } catch {
        return null; // malformed percent-encoding
    }

    if (decoded.includes('\0')) return null;

    const target = path.resolve(root, '.' + (decoded.startsWith('/') ? decoded : '/' + decoded));
    const relative = path.relative(root, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
    if (relative && relative.split(path.sep).some(segment => segment.startsWith('.'))) return null;

    return target;
}

/**
 * Same, for a path the server is about to WRITE. Markdown only: this editor
 * edits documents, and an endpoint that writes arbitrary extensions under the
 * root is a way to drop a .js, a .command or an .html next to them.
 *
 * @returns {string|null}
 */
export function markdownTarget(root, requested) {
    const target = resolveInRoot(root, requested);
    if (!target) return null;
    if (path.extname(target).toLowerCase() !== '.md') return null;
    return target;
}

/** The URL path a file is served at, always "/"-joined. */
export function hrefFor(root, file) {
    return '/' + path.relative(root, file).split(path.sep).join('/');
}
