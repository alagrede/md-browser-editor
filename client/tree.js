// The explorer. Which directories are expanded is state of the page, not of
// the server, so it survives the tree being rebuilt after every write — a file
// created here appears without a reload and without collapsing everything.

const openDirs = new Set();

export function isOpen(dirPath) {
    return openDirs.has(dirPath);
}

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
    list.className = 'tree-level';

    for (const node of nodes) {
        const item = document.createElement('li');
        const row = document.createElement('button');
        row.className = 'tree-row';
        row.style.paddingLeft = `${depth * 12 + 8}px`;

        if (node.type === 'dir') {
            const open = openDirs.has(node.path);
            row.classList.add('tree-dir');
            const chevron = span('chevron', open ? '▾' : '▸');
            row.append(chevron, span('tree-name', node.name));

            // A directory that has an index.md IS a document: its row opens it,
            // and only the chevron folds it. Without an index there is nothing
            // to open, so the whole row toggles.
            if (node.index) {
                row.classList.add('tree-dir-page');
                if (node.index === handlers.current) row.classList.add('current');
                row.title = node.index;
                chevron.onclick = event => {
                    event.stopPropagation();
                    handlers.onToggle(node.path);
                };
                row.onclick = () => handlers.onOpen(node.index);
            } else {
                row.onclick = () => handlers.onToggle(node.path);
            }

            item.appendChild(row);
            if (open) item.appendChild(level(node.children ?? [], handlers, depth + 1));
        } else {
            row.classList.add('tree-file');
            if (node.path === handlers.current) row.classList.add('current');
            row.append(span('tree-icon', '📄'), span('tree-name', node.name.replace(/\.md$/i, '')));
            row.title = node.path;
            row.onclick = () => handlers.onOpen(node.path);
            item.appendChild(row);
        }

        list.appendChild(item);
    }

    return list;
}

function span(className, text) {
    const element = document.createElement('span');
    element.className = className;
    element.textContent = text;
    return element;
}
