// Mentions: a passage of a document, plus what you want an AI agent to do with
// it. They live IN the markdown, as HTML comments around the passage:
//
//     <!--ai:a3f Reformule ça, trop jargonneux-->
//     Le service expose un endpoint idempotent…
//     <!--/ai:a3f-->
//
// Why in the document rather than in a sidecar: the anchor never drifts (the
// text moves, its markers move with it), the instruction sits exactly where it
// applies so an agent opening the file reads both together, it survives a
// rename, it shows up in a git diff — and HTML comments render as nothing, in
// this editor and in every other markdown tool.
//
// An agent's contract is three lines: read the mentions (`mentions --json`),
// edit the passage between the markers, then drop the markers (or call
// `mentions --resolve <id>`) to mark the request done.

/** Marker syntax. The id is what pairs an opening comment with its closing one. */
const OPEN = /<!--\s*ai:([A-Za-z0-9_-]{1,32})\s([\s\S]*?)-->/g;
const closeFor = id => new RegExp(`<!--\\s*/ai:${escapeRegExp(id)}\\s*-->`);

function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * An instruction is stored verbatim inside an HTML comment, so the only
 * sequence it cannot contain is the comment terminator. Replacing it keeps the
 * document parseable instead of producing a marker that swallows the passage.
 */
export function sanitizePrompt(prompt) {
    return String(prompt ?? '')
        .replace(/-->/g, '--→')
        .replace(/\r?\n/g, ' ')
        .trim();
}

/** Ids are short, readable in a diff, and unique within one document. */
export function newMentionId(existing = []) {
    const taken = new Set(existing);
    for (let attempt = 0; attempt < 1000; attempt++) {
        const id = Math.random().toString(36).slice(2, 6);
        if (!taken.has(id)) return id;
    }
    return `m${Date.now().toString(36)}`;
}

/**
 * Every mention in a document, in source order.
 *
 * An opening marker with no closing one is reported with `unterminated: true`
 * rather than dropped: it is the shape a hand-edit leaves behind, and silently
 * ignoring it would lose the instruction.
 *
 * @returns {Array<{id: string, prompt: string, text: string, from: number, to: number,
 *                  bodyFrom: number, bodyTo: number, unterminated: boolean}>}
 */
export function parseMentions(source) {
    const content = String(source ?? '');
    const found = [];
    OPEN.lastIndex = 0;
    let match;

    while ((match = OPEN.exec(content)) !== null) {
        const [raw, id, rawPrompt] = match;
        const from = match.index;
        const bodyFrom = from + raw.length;
        const close = closeFor(id).exec(content.slice(bodyFrom));

        if (!close) {
            found.push({
                id,
                prompt: rawPrompt.trim(),
                text: '',
                from,
                to: bodyFrom,
                bodyFrom,
                bodyTo: bodyFrom,
                unterminated: true,
            });
            continue;
        }

        const bodyTo = bodyFrom + close.index;
        found.push({
            id,
            prompt: rawPrompt.trim(),
            text: content.slice(bodyFrom, bodyTo).trim(),
            from,
            to: bodyTo + close[0].length,
            bodyFrom,
            bodyTo,
            unterminated: false,
        });
        // Nested mentions are not a thing: keep scanning after this one.
        OPEN.lastIndex = bodyTo + close[0].length;
    }

    return found;
}

/**
 * Wraps [from, to) with a new mention and returns the new source plus the id.
 * The markers sit on their own lines when the selection covers whole lines, so
 * a block-level passage keeps its markdown block structure (a marker glued to
 * the front of a `## heading` line would stop it being a heading).
 */
export function insertMention(source, from, to, prompt) {
    const content = String(source ?? '');
    const start = Math.max(0, Math.min(from, to));
    let end = Math.min(content.length, Math.max(from, to));
    // Selecting whole lines (a triple-click, a shift-down) takes the trailing
    // newline with them. Keeping it inside the mention would push the closing
    // marker onto the NEXT line, in front of whatever starts it.
    while (end > start && content[end - 1] === '\n') end -= 1;
    const id = newMentionId(parseMentions(content).map(mention => mention.id));
    const open = `<!--ai:${id} ${sanitizePrompt(prompt)}-->`;
    const close = `<!--/ai:${id}-->`;

    const atLineStart = start === 0 || content[start - 1] === '\n';
    const atLineEnd = end === content.length || content[end] === '\n';
    const selected = content.slice(start, end);

    const block = atLineStart && atLineEnd && selected.includes('\n');
    const body = block ? `${open}\n${selected}\n${close}` : `${open}${selected}${close}`;

    return { id, source: content.slice(0, start) + body + content.slice(end) };
}

/**
 * Removes a mention's markers, keeping its text. This is what "the request is
 * done" looks like in the file.
 */
export function removeMention(source, id) {
    const content = String(source ?? '');
    const mention = parseMentions(content).find(item => item.id === id);
    if (!mention) return content;

    const body = content.slice(mention.bodyFrom, mention.bodyTo);
    const kept = mention.unterminated ? body : body.replace(/^\n/, '').replace(/\n$/, '');
    return content.slice(0, mention.from) + kept + content.slice(mention.to);
}

/** Same, for every mention of a document. */
export function removeAllMentions(source) {
    let content = String(source ?? '');
    for (const mention of parseMentions(content)) {
        content = removeMention(content, mention.id);
    }
    return content;
}
