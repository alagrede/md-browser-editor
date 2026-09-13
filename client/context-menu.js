// Right-click inside the editor: format, turn into, insert.
//
// It replaces the browser's menu, which is a real cost — so it keeps Cut and
// Copy, and the browser's own is still one Shift-right-click away (Chrome and
// Firefox both let that through). Paste is deliberately absent: reading the
// clipboard from a page needs a permission prompt, and ⌘V never needed one.

let open = null;

function close() {
    open?.remove();
    open = null;
    document.removeEventListener('mousedown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
}

function onOutside(event) {
    if (open && !open.contains(event.target)) close();
}

function onKey(event) {
    if (event.key === 'Escape') {
        event.preventDefault();
        close();
    }
}

const isSeparator = item => item === '-';

function build(items, view) {
    const menu = document.createElement('div');
    menu.className = 'ctx-menu';

    for (const item of items) {
        if (isSeparator(item)) {
            const rule = document.createElement('div');
            rule.className = 'ctx-sep';
            menu.appendChild(rule);
            continue;
        }
        if (item.heading) {
            const heading = document.createElement('div');
            heading.className = 'ctx-heading';
            heading.textContent = item.heading;
            menu.appendChild(heading);
            continue;
        }

        const button = document.createElement('button');
        button.className = 'ctx-item';
        button.type = 'button';
        button.disabled = item.enabled === false;

        const label = document.createElement('span');
        label.textContent = item.label;
        button.appendChild(label);

        if (item.key) {
            const shortcut = document.createElement('kbd');
            shortcut.textContent = item.key;
            button.appendChild(shortcut);
        }

        button.onclick = () => {
            close();
            view.focus();
            item.run(view);
        };
        menu.appendChild(button);
    }

    return menu;
}

/**
 * @param {EditorView} view
 * @param {{x: number, y: number}} at
 * @param {Array} items
 */
export function showContextMenu(view, at, items) {
    close();
    const menu = build(items, view);
    menu.style.visibility = 'hidden';
    document.body.appendChild(menu);

    // Flip rather than overflow: a menu opened near the bottom right of the
    // window would otherwise extend past it and lose its last entries.
    const size = menu.getBoundingClientRect();
    const x = at.x + size.width > window.innerWidth - 8 ? Math.max(8, at.x - size.width) : at.x;
    const y = at.y + size.height > window.innerHeight - 8 ? Math.max(8, at.y - size.height) : at.y;
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.style.visibility = 'visible';

    open = menu;
    document.addEventListener('mousedown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
}

export const closeContextMenu = close;
