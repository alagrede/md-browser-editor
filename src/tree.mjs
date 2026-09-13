// The explorer tree: directories and .md files under the root.
//
// Dotted entries are skipped for the same reason the path resolver refuses
// them (.git/, .env), and so are the usual heavy directories nobody wants to
// expand in a documentation tree.
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { documentTitle } from './frontmatter.mjs';

const SKIP = new Set(['node_modules', 'dist', 'build', 'coverage', '.git']);

/**
 * A directory's own page. `guide/index.md` is not a file *in* guide/, it IS
 * guide/ — the convention static site generators and wiki exports share. So it
 * takes the folder's row instead of sitting inside it under a name that says
 * nothing, and the folder becomes clickable.
 */
const INDEX_NAME = 'index.md';

// Sorted by FILE name, even though the title is what is displayed: a numeric
// prefix (01-intro.md) is the only ordering lever an author has left once the
// file name stops being shown, and it is the convention every docs-as-code
// generator already uses.
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

/**
 * What a document is called: its frontmatter `title`, else its first heading.
 * Reading every file on every tree request is the cost of showing real names
 * instead of slugs, so the result is kept until the file's mtime moves.
 */
const titleCache = new Map(); // absolute path -> {mtimeMs, title}

async function titleOf(file) {
    let info;
    try {
        info = await stat(file);
    } catch {
        return undefined;
    }
    const cached = titleCache.get(file);
    if (cached && cached.mtimeMs === info.mtimeMs) return cached.title;

    let title;
    try {
        // The name lives at the top; a whole 2 MB changelog need not be read.
        const head = (await readFile(file, 'utf8')).slice(0, 4096);
        title = documentTitle(head) ?? undefined;
    } catch {
        title = undefined;
    }
    titleCache.set(file, { mtimeMs: info.mtimeMs, title });
    return title;
}

const isIndex = name => name.toLowerCase() === INDEX_NAME;

/**
 * @returns {Promise<{nodes: Array, index: string|undefined}>}
 *   `index` is the directory's own page, when it has one.
 */
async function scan(root, dir) {
    let entries;
    try {
        entries = await readdir(dir, { withFileTypes: true });
    } catch {
        return { nodes: [], index: undefined };
    }

    const relativeOf = name => path.relative(root, path.join(dir, name)).split(path.sep).join('/');
    const dirs = [];
    const files = [];
    let index;

    for (const entry of entries) {
        if (entry.name.startsWith('.') || SKIP.has(entry.name)) continue;

        if (entry.isDirectory()) {
            const child = await scan(root, path.join(dir, entry.name));
            const indexTitle = child.index ? await titleOf(path.join(root, child.index)) : undefined;
            // A directory holding no markdown anywhere below is noise in a
            // documentation tree (an images/ folder, a build leftover) — but a
            // directory that IS a page stays, children or not.
            if (child.nodes.length || child.index) {
                dirs.push({
                    type: 'dir',
                    name: entry.name,
                    path: relativeOf(entry.name),
                    // A directory that is a page is named by that page; a plain
                    // directory keeps its folder name, which is all it has.
                    ...(indexTitle ? { title: indexTitle } : {}),
                    ...(child.index ? { index: child.index } : {}),
                    children: child.nodes,
                });
            }
            continue;
        }

        if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;

        if (isIndex(entry.name) && dir !== root) {
            // It becomes the directory's row; listing it here too would be the
            // same document twice.
            index = relativeOf(entry.name);
            continue;
        }
        const title = await titleOf(path.join(dir, entry.name));
        files.push({ type: 'file', name: entry.name, path: relativeOf(entry.name), ...(title ? { title } : {}) });
    }

    dirs.sort(byName);
    files.sort(byName);
    return { nodes: [...dirs, ...files], index };
}

/** The tree the browser renders. `path` is root-relative and "/"-joined. */
export async function buildTree(root) {
    return (await scan(root, root)).nodes;
}

/** The root's own page, if it has one — the sidebar header opens it. */
export async function rootIndex(root) {
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    return entries.some(entry => entry.isFile() && isIndex(entry.name)) ? INDEX_NAME : undefined;
}

/**
 * Flat list of every markdown file in the tree, root-relative — index pages
 * included, since they are documents like any other (and carry mentions).
 */
export function flattenFiles(nodes, out = []) {
    for (const node of nodes) {
        if (node.type === 'file') {
            out.push(node.path);
            continue;
        }
        if (node.index) out.push(node.index);
        flattenFiles(node.children ?? [], out);
    }
    return out;
}
