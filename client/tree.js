// The explorer. Which directories are expanded is state of the page, not of
// the server, so it survives the tree being rebuilt after every write — a file
// created here appears without a reload and without collapsing everything.
import { chevronIcon, fileIcon, folderIcon, folderPageIcon } from './icons.js';

const openDirs = new Set();

export function toggleDir(dirPath) {
    if (openDirs.has(dirPath)) openDirs.delete(dirPath);
    else openDirs.add(dirPath);
}

/** Expands every ancestor of a file, so revealing it needs no clicking. */
export function revealFile(filePath) {
    const parts = String(filePath).split('/');
    parts.pop();
    let prefix = '';
    for (const part of parts) {
        prefix = prefix ? `${prefix}/${part}` : part;
        openDirs.add(prefix);
    }
}

/**
 * @param {HTMLElement} container
 * @param {Array} nodes tree from /api/tree
 * @param {{current: string|null, onOpen: (path: string) => void, onToggle: (path: string) => void}} handlers
 */
export function renderTree(container, nodes, handlers) {
    container.textContent = '';
    container.appendChild(level(nodes, handlers, 0));
}

function level(nodes, handlers, depth) {
    const list = document.createElement('ul');
    list.className = depth === 0 ? 'tree-level' : 'tree-level tree-nested';

    for (const node of nodes) {
        const item = document.createElement('li');
        const row = document.createElement('button');
        row.className = 'tree-row';
        row.type = 'button';

        if (node.type === 'dir') {
            const open = openDirs.has(node.path);
            row.classList.add('tree-dir');
            if (open) row.classList.add('open');

            const twisty = document.createElement('span');
            twisty.className = 'tree-twisty';
            twisty.appendChild(chevronIcon());

            const icon = document.createElement('span');
            icon.className = 'tree-icon';
            icon.appendChild(node.index ? folderPageIcon() : folderIcon());

            row.append(twisty, icon, label(node.title ?? node.name));

            // A directory that has an index.md IS a document: its row opens it,
            // and only the twisty folds it. Without an index there is nothing to
            // open, so the whole row toggles.
            if (node.index) {
                if (node.index === handlers.current) row.classList.add('current');
                row.title = node.index;
                twisty.onclick = event => {
                    event.stopPropagation();
                    handlers.onToggle(node.path);
                };
                row.onclick = () => handlers.onOpen(node.index);
            } else {
                row.classList.add('tree-dir-plain');
                row.title = node.path;
                row.onclick = () => handlers.onToggle(node.path);
            }

            item.appendChild(row);
            if (open) item.appendChild(level(node.children ?? [], handlers, depth + 1));
        } else {
            row.classList.add('tree-file');
            if (node.path === handlers.current) row.classList.add('current');

            const icon = document.createElement('span');
            icon.className = 'tree-icon';
            icon.appendChild(fileIcon());

            // The document's own name when it has one (frontmatter title, else
            // its first heading); the file name is only a fallback — and the
            // path stays one hover away.
            row.append(spacer(), icon, label(node.title ?? node.name.replace(/\.md$/i, '')));
            row.title = node.path;
            row.onclick = () => handlers.onOpen(node.path);
            item.appendChild(row);
        }

        list.appendChild(item);
    }

    return list;
}

/** Keeps a file's icon aligned with a folder's, which has a twisty in front. */
function spacer() {
    const element = document.createElement('span');
    element.className = 'tree-twisty tree-twisty-empty';
    return element;
}

function label(text) {
    const element = document.createElement('span');
    element.className = 'tree-name';
    element.textContent = text;
    return element;
}
