// The explorer tree: directories and .md files under the root.
//
// Dotted entries are skipped for the same reason the path resolver refuses
// them (.git/, .env), and so are the usual heavy directories nobody wants to
// expand in a documentation tree.
import { readdir } from 'node:fs/promises';
import path from 'node:path';

const SKIP = new Set(['node_modules', 'dist', 'build', 'coverage', '.git']);

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

/**
 * @returns {Promise<Array<{type: 'dir'|'file', name: string, path: string, children?: Array}>>}
 *   `path` is root-relative and "/"-joined — the id the browser sends back.
 */
export async function buildTree(root, dir = root) {
    let entries;
    try {
        entries = await readdir(dir, { withFileTypes: true });
    } catch {
        return [];
    }

    const dirs = [];
    const files = [];

    for (const entry of entries) {
        if (entry.name.startsWith('.') || SKIP.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        const relative = path.relative(root, full).split(path.sep).join('/');

        if (entry.isDirectory()) {
            const children = await buildTree(root, full);
            // A directory holding no markdown anywhere below is noise in a
            // documentation tree (an images/ folder, a build leftover).
            if (children.length) dirs.push({ type: 'dir', name: entry.name, path: relative, children });
            continue;
        }
        if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
            files.push({ type: 'file', name: entry.name, path: relative });
        }
    }

    dirs.sort(byName);
    files.sort(byName);
    return [...dirs, ...files];
}

/** Flat list of every markdown file in the tree, root-relative. */
export function flattenFiles(nodes, out = []) {
    for (const node of nodes) {
        if (node.type === 'file') out.push(node.path);
        else flattenFiles(node.children ?? [], out);
    }
    return out;
}
