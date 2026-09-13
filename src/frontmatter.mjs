// YAML frontmatter: the `---` block at the very top of a document.
//
// Markdown parsers do not know about it, and what they make of it is worse
// than nothing: `title: Guide` followed by `---` is a *setext heading*, so an
// unhandled frontmatter renders as a giant title made of its own metadata.
//
// The parser below covers the flat shape frontmatter actually has — scalars,
// quoted strings, inline `[a, b]` and block `- item` lists — and says so when
// it meets something else (`nested`), instead of guessing. That keeps a real
// YAML dependency out of both the server and the browser bundle.

/** The block's position in a document, or null when there is none. */
export function findFrontmatter(source) {
    const content = String(source ?? '');
    if (!content.startsWith('---')) return null;

    const firstBreak = content.indexOf('\n');
    if (firstBreak === -1 || content.slice(0, firstBreak).trim() !== '---') return null;

    const lines = content.split('\n');
    for (let index = 1; index < lines.length; index++) {
        if (lines[index].trim() !== '---') continue;
        const body = lines.slice(1, index).join('\n');
        const to = lines.slice(0, index + 1).join('\n').length;
        return { from: 0, to, body, raw: content.slice(0, to) };
    }
    return null; // an opening fence with no closing one is not a block
}

const unquote = value => {
    const text = value.trim();
    if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
        const inner = text.slice(1, -1);
        return text[0] === '"' ? inner.replace(/\\"/g, '"').replace(/\\\\/g, '\\') : inner.replace(/''/g, "'");
    }
    return text;
};

const splitInline = value =>
    value
        .slice(1, -1)
        .split(',')
        .map(item => unquote(item))
        .filter(item => item.length > 0);

/**
 * The block's properties, in document order.
 *
 * @returns {Array<{key: string, value: string|string[], nested: boolean}>}
 *   `nested` marks a key whose value is a map or anything else this subset does
 *   not model — the editor shows those raw rather than pretending.
 */
export function parseFrontmatter(body) {
    const lines = String(body ?? '').split('\n');
    const properties = [];
    let current = null;

    for (const line of lines) {
        if (!line.trim() || line.trim().startsWith('#')) continue;

        // "  - item": another entry of the list opened by the previous key
        const listItem = /^\s+-\s*(.*)$/.exec(line);
        if (listItem && current) {
            if (!Array.isArray(current.value)) current.value = current.value ? [current.value] : [];
            current.value.push(unquote(listItem[1]));
            continue;
        }

        const match = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line);
        if (!match) {
            // An indented line that is not a list item: a nested map.
            if (current && /^\s+\S/.test(line)) current.nested = true;
            continue;
        }

        const [, key, rest] = match;
        const value = rest.trim();
        current = {
            key,
            value: value.startsWith('[') && value.endsWith(']') ? splitInline(value) : unquote(value),
            nested: false,
        };
        properties.push(current);
    }

    return properties;
}

/** Properties as a plain object, for callers that just want `title`. */
export function frontmatterOf(source) {
    const block = findFrontmatter(source);
    if (!block) return {};
    return Object.fromEntries(parseFrontmatter(block.body).map(property => [property.key, property.value]));
}

/** The document without its frontmatter — what a title lookup should read. */
export function stripFrontmatter(source) {
    const block = findFrontmatter(source);
    return block ? String(source).slice(block.to).replace(/^\n+/, '') : String(source ?? '');
}

/**
 * What to call a document: its frontmatter title, else its first level-1
 * heading, else null (the caller knows its own file name).
 */
export function documentTitle(source) {
    const { title } = frontmatterOf(source);
    if (typeof title === 'string' && title.trim()) return title.trim();

    for (const line of stripFrontmatter(source).split('\n')) {
        const heading = /^#\s+(.+?)\s*$/.exec(line);
        if (heading) return heading[1].replace(/\s*#+\s*$/, '').trim();
        // Only a leading heading counts: the first one after paragraphs of text
        // is a section, not the document's name.
        if (line.trim() && !line.trim().startsWith('#')) return null;
    }
    return null;
}
