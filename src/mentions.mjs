// Mentions: what you want an AI agent to do, attached to the text it applies
// to. They live IN the markdown, as HTML comments around the passage:
//
//     <!--ai:a3f Rephrase this, too much jargon-->
//     The service exposes an idempotent endpoint…
//     <!--/ai:a3f-->
//
// Some requests are about the document as a whole — "rewrite this page for a
// non-technical audience" — and wrapping the entire file to say so would
// highlight everything and put a marker in front of its first heading. Those
// get a single marker at the top instead, and no passage:
//
//     <!--ai:file:a3f Rewrite this page for a non-technical audience-->
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

import { findFrontmatter } from './frontmatter.mjs';

/**
 * Marker syntax. The id is what pairs an opening comment with its closing one;
 * the optional `file:` says the instruction is about the whole document, and
 * such a marker stands alone — there is nothing for it to close.
 */
const OPEN = /<!--\s*ai:(file:)?([A-Za-z0-9_-]{1,32})\s([\s\S]*?)-->/g;
const FILE_MARKER = /^<!--\s*ai:file:[A-Za-z0-9_-]{1,32}\s[\s\S]*?-->/;
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
 * `scope` is `'passage'` for the wrapping form and `'file'` for the standalone
 * one; a file mention has no text of its own, because its subject is the whole
 * document.
 *
 * An opening marker with no closing one is reported with `unterminated: true`
 * rather than dropped: it is the shape a hand-edit leaves behind, and silently
 * ignoring it would lose the instruction. A file marker is not that — it is
 * complete as it stands.
 *
 * @returns {Array<{id: string, scope: 'passage'|'file', prompt: string, text: string,
 *                  from: number, to: number, bodyFrom: number, bodyTo: number,
 *                  unterminated: boolean}>}
 */
export function parseMentions(source) {
    const content = String(source ?? '');
    const found = [];
    OPEN.lastIndex = 0;
    let match;

    while ((match = OPEN.exec(content)) !== null) {
        const [raw, fileScope, id, rawPrompt] = match;
        const from = match.index;
        const bodyFrom = from + raw.length;

        if (fileScope) {
            found.push({
                id,
                scope: 'file',
                prompt: rawPrompt.trim(),
                text: '',
                from,
                to: bodyFrom,
                bodyFrom,
                bodyTo: bodyFrom,
                unterminated: false,
            });
            continue;
        }

        const close = closeFor(id).exec(content.slice(bodyFrom));

        if (!close) {
            found.push({
                id,
                scope: 'passage',
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
            scope: 'passage',
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
 * Leaves a mention about the whole document — no selection needed.
 *
 * The marker goes on its own line at the top of the body, which is where an
 * agent opening the file reads it first, and *below* the frontmatter: above it
 * the `---` fence would no longer start the document, and the block would stop
 * being frontmatter at all. Several of them stack in the order they were left.
 */
export function insertFileMention(source, prompt) {
    const content = String(source ?? '');
    const id = newMentionId(parseMentions(content).map(mention => mention.id));
    const marker = `<!--ai:file:${id} ${sanitizePrompt(prompt)}-->`;

    const front = findFrontmatter(content);
    let at = front ? front.to : 0;
    const skipBlanks = () => {
        while (content[at] === '\n') at += 1;
    };

    skipBlanks();
    // Past the file mentions already there, so the newest is the last one and
    // the order in the file is the order they were asked for.
    let rest;
    while (FILE_MARKER.test((rest = content.slice(at)))) {
        at += FILE_MARKER.exec(rest)[0].length;
        skipBlanks();
    }

    const after = content.slice(at);
    const body = after ? `${marker}\n\n` : `${marker}\n`;
    return { id, source: content.slice(0, at) + body + after };
}

/**
 * Removes a mention's markers, keeping its text. This is what "the request is
 * done" looks like in the file.
 */
export function removeMention(source, id) {
    const content = String(source ?? '');
    const mention = parseMentions(content).find(item => item.id === id);
    if (!mention) return content;

    if (mention.scope === 'file') {
        // A file mention has no text to keep — the marker goes, and with it the
        // line it sits on, or resolving one would leave a blank line behind.
        let to = mention.to;
        if (mention.from === 0 || content[mention.from - 1] === '\n') {
            // It starts a line: take the rest of that line's break with it, and
            // the blank line that separated it from the body. A marker with text
            // after it on the same line is left where it is.
            while (content[to] === '\n') to += 1;
        }
        return content.slice(0, mention.from) + content.slice(to);
    }

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
