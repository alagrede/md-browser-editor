// Which document the editor is showing, as a root-relative path.
//
// A markdown image path is relative to the FILE that carries it, and the page
// URL is always "/" whatever is open — so without this, `assets/shot.png` in
// guide/index.md resolved to /assets/shot.png instead of
// /guide/assets/shot.png. The failure is quiet when a root assets/ folder also
// exists: the request hits a real directory and simply finds nothing.
import { Facet } from '@codemirror/state';

export const docPath = Facet.define({
    combine: values => values[0] ?? '',
});

/** What to do when a rendered link is clicked. Provided by main.js. */
export const followLink = Facet.define({
    combine: values => values[0] ?? (() => {}),
});

/**
 * Percent-encodes a path segment by segment, decoding first: markdown written
 * by a tool already carries `%20`, and encodeURI would turn that into `%2520`
 * — a request for a file whose name really does contain "%20".
 */
function encodePath(path) {
    return path
        .split('/')
        .map(segment => {
            let decoded = segment;
            try {
                decoded = decodeURIComponent(segment);
            } catch {
                /* a stray % that is not an escape: encode it as it stands */
            }
            return encodeURIComponent(decoded);
        })
        .join('/');
}

/** Normalizes "a/b/../c" and drops "./" — no node:path in the browser. */
function normalize(path) {
    const out = [];
    for (const segment of path.split('/')) {
        if (!segment || segment === '.') continue;
        if (segment === '..') out.pop();
        else out.push(segment);
    }
    return out.join('/');
}

/**
 * The URL an asset referenced from `from` is served at.
 *
 * @param {string} url the markdown path, as written
 * @param {string} from the document's root-relative path
 * @returns {string|null} an absolute URL path, or null when the reference is
 *   already a URL the browser can use as it stands
 */
export function assetUrl(url, from) {
    const raw = String(url ?? '').trim();
    if (!raw) return null;
    // A scheme (http:, data:, file:) or a protocol-relative URL: not ours.
    if (/^[a-z][a-z0-9+.-]+:/i.test(raw) || raw.startsWith('//')) return null;
    if (raw.startsWith('/')) return '/' + encodePath(normalize(raw));

    const directory = String(from ?? '');
    const base = directory.includes('/') ? directory.slice(0, directory.lastIndexOf('/')) : '';
    return '/' + encodePath(normalize(base ? `${base}/${raw}` : raw));
}

/** Where the same reference would sit if it were relative to the root. */
export function rootAssetUrl(url) {
    const raw = String(url ?? '').trim();
    if (!raw || /^[a-z][a-z0-9+.-]+:/i.test(raw) || raw.startsWith('//')) return null;
    return '/' + encodePath(normalize(raw.replace(/^\/+/, '')));
}

/**
 * What a link in a document points at.
 *
 * A relative `.md` is another document of the tree and belongs in the editor —
 * handing it to the browser asks the server for a markdown file, which it
 * refuses to serve (it serves documents rendered, not raw), so the link looked
 * broken. Anything else is the browser's business.
 *
 * @returns {{kind: 'document'|'asset'|'external', path?: string, hash?: string, url?: string}}
 */
export function linkTarget(href, from) {
    const raw = String(href ?? '').trim();
    if (!raw) return { kind: 'external', url: raw };

    // A bare fragment stays in the document being read.
    if (raw.startsWith('#')) return { kind: 'document', path: String(from ?? ''), hash: raw.slice(1) };

    if (/^[a-z][a-z0-9+.-]+:/i.test(raw) || raw.startsWith('//')) return { kind: 'external', url: raw };

    const [pathPart, ...rest] = raw.split('#');
    const hash = rest.join('#');

    if (!/\.md$/i.test(pathPart)) {
        // An image, a PDF: the server serves those, the browser displays them.
        return { kind: 'asset', url: assetUrl(pathPart, from) ?? pathPart };
    }

    const url = assetUrl(pathPart, from); // same resolution rules as an image
    return { kind: 'document', path: url ? decodeURIComponent(url.replace(/^\//, '')) : pathPart, hash };
}
