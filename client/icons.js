// Inline SVG rather than emoji: 📄 and 📁 render differently on every platform,
// carry their own colors (a bright white sheet shouts on a dark sidebar), and
// cannot follow the row's state. These are single-path outlines in
// currentColor, so a row's icon dims and highlights with its text.

const svg = (paths, { size = 15 } = {}) => {
    const element = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    element.setAttribute('viewBox', '0 0 24 24');
    element.setAttribute('width', String(size));
    element.setAttribute('height', String(size));
    element.setAttribute('fill', 'none');
    element.setAttribute('stroke', 'currentColor');
    element.setAttribute('stroke-width', '1.7');
    element.setAttribute('stroke-linecap', 'round');
    element.setAttribute('stroke-linejoin', 'round');
    element.setAttribute('aria-hidden', 'true');
    for (const definition of paths) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', definition);
        element.appendChild(path);
    }
    return element;
};

/** A document. */
export const fileIcon = () =>
    svg(['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z', 'M14 3v5h5']);

/** A plain folder. */
export const folderIcon = () => svg(['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z']);

/**
 * A folder that is also a page (it carries an index.md). One line inside the
 * folder, not two: at 15px a second line turns the glyph into noise.
 */
export const folderPageIcon = () =>
    svg(['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M8 13h8']);

/** The twisty, rotated by CSS when its row is open. */
export const chevronIcon = () => svg(['M9 6l6 6-6 6'], { size: 12 });
