// Telling the browser that a file changed under it.
//
// Without this, an agent rewriting the documents while the editor is open is a
// data-loss bug waiting to happen: the tab keeps the old buffer, and the next
// keystroke saves it over the agent's work.
//
// fs.watch with `recursive` covers macOS and Windows; on the platforms where it
// is not supported it throws, and a periodic scan takes over. Either way the
// caller gets one callback, and only while somebody is listening.
import { watch } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const SKIP = new Set(['node_modules', 'dist', 'build', 'coverage', '.git']);
const POLL_MS = 1500;
const DEBOUNCE_MS = 120;

/** A signature of every markdown file's path and mtime, for the fallback. */
async function signature(root, dir = root, out = []) {
    let entries;
    try {
        entries = await readdir(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const entry of entries) {
        if (entry.name.startsWith('.') || SKIP.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            await signature(root, full, out);
            continue;
        }
        if (!entry.name.toLowerCase().endsWith('.md')) continue;
        try {
            out.push(`${path.relative(root, full)}:${(await stat(full)).mtimeMs}`);
        } catch {
            /* vanished mid-scan: the next pass will report it */
        }
    }
    return out;
}

/**
 * @param {string} root
 * @param {(paths: string[]) => void} onChange called with the root-relative
 *   paths that moved, or an empty array when the watcher cannot say which.
 * @returns {{stop: () => void, watching: 'fs'|'poll'}}
 */
export function watchTree(root, onChange) {
    let timer = null;
    let pending = new Set();

    const flush = () => {
        timer = null;
        const paths = [...pending];
        pending = new Set();
        onChange(paths);
    };

    const report = relative => {
        if (relative) pending.add(relative);
        if (timer) return;
        // Editors and tools write in bursts (truncate, write, chmod); one
        // notification per burst is what a reader wants.
        timer = setTimeout(flush, DEBOUNCE_MS);
    };

    try {
        const watcher = watch(root, { recursive: true }, (_event, filename) => {
            if (!filename) return void report(null);
            const relative = String(filename).split(path.sep).join('/');
            if (relative.split('/').some(segment => segment.startsWith('.') || SKIP.has(segment))) return;
            report(relative);
        });
        watcher.on('error', () => {
            /* the tree moved out from under us: nothing useful to do here */
        });
        return {
            watching: 'fs',
            stop: () => {
                clearTimeout(timer);
                watcher.close();
            },
        };
    } catch {
        // Recursive watching unsupported (Linux): compare snapshots instead.
        let previous = null;
        const tick = async () => {
            const current = (await signature(root)).sort().join('|');
            if (previous !== null && current !== previous) onChange([]);
            previous = current;
        };
        tick();
        const interval = setInterval(tick, POLL_MS);
        return {
            watching: 'poll',
            stop: () => {
                clearTimeout(timer);
                clearInterval(interval);
            },
        };
    }
}
