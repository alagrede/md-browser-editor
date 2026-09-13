// The agent contract, in one place.
//
// Claude Code reads project slash commands from .claude/commands/<name>.md, so
// the loop becomes `/mentions`. Codex has no project-level command directory —
// what it reads on its own is AGENTS.md — so there the same instructions go in
// as a managed section, and asking for the mentions in plain language works.
//
// Both are generated from the text below: two copies of a contract that drift
// is worse than no copy at all.

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const MENTIONS_COMMAND_NAME = 'mentions';

/** Delimiters of the section this tool owns inside a file it does not own. */
export const SECTION_OPEN = '<!-- md-browser-editor:mentions -->';
export const SECTION_CLOSE = '<!-- /md-browser-editor:mentions -->';

const BODY = `A mention is an instruction attached to a passage, stored in the document
itself as a pair of HTML comments:

\`\`\`markdown
<!--ai:a3f Reformule ça, trop jargonneux-->
…the passage it applies to…
<!--/ai:a3f-->
\`\`\`

Applying them:

1. Run \`npx md-browser-editor mentions . --json\` to read them all.
2. For each mention, apply its \`prompt\` to the passage **between its markers**,
   and only to that passage. Edit the file in place.
3. Drop that mention's markers once it is done:
   \`npx md-browser-editor mentions . --resolve <id>\`. Leaving them in place
   means the request is still open, so an unresolved marker is how you say "I
   did not do this one".
4. When every mention is handled, run \`npx md-browser-editor mentions .\` again
   and report what is left.

Rules:

- Change nothing outside the marked passages. A mention is not an invitation to
  tidy the rest of the document.
- Keep the document's language: answer in the language the passage is written in.
- A mention reported as \`unterminated\` has an opening marker and no closing one,
  so it annotates nothing. Do not guess its extent — report it and move on.
- If a prompt is ambiguous enough that two readings would produce different text,
  say so instead of picking one.
- If the directory is a git repository, leave the work as a reviewable diff and
  do not commit. If it is not, say so before you start: without git there is no
  undo for what you are about to rewrite.
- The editor may be open on these files while you work. It follows them: a
  document nobody is editing reloads itself, and a save that would land on top
  of your work is refused. You do not have to coordinate.`;

/** The Claude Code slash command file. */
export function claudeCommand() {
    return `---
description: Apply the mentions left in the markdown, then drop their markers
---

Apply the mentions left in this directory's markdown documents.

${BODY}

$ARGUMENTS
`;
}

/** The AGENTS.md section, between its markers so it can be replaced in place. */
export function agentsSection() {
    return `${SECTION_OPEN}

## Mentions in the markdown

${BODY}

${SECTION_CLOSE}`;
}

/**
 * Puts `section` into `existing`, replacing the previous one if this tool has
 * already written there. A file it does not own is only ever appended to — an
 * AGENTS.md holds a project's own instructions, and losing them to a tool that
 * wanted to add a paragraph would be unforgivable.
 *
 * @returns {{content: string, action: 'created'|'updated'|'appended'|'unchanged'}}
 */
export function upsertSection(existing, section) {
    const content = String(existing ?? '');
    if (!content.trim()) return { content: `${section}\n`, action: 'created' };

    const start = content.indexOf(SECTION_OPEN);
    const end = content.indexOf(SECTION_CLOSE);

    if (start !== -1 && end > start) {
        const next = content.slice(0, start) + section + content.slice(end + SECTION_CLOSE.length);
        return { content: next, action: next === content ? 'unchanged' : 'updated' };
    }

    return { content: `${content.replace(/\s*$/, '')}\n\n${section}\n`, action: 'appended' };
}


/** Where each agent reads its instructions, relative to a directory. */
export const CLAUDE_COMMAND_PATH = path.join('.claude', 'commands', `${MENTIONS_COMMAND_NAME}.md`);
export const CODEX_AGENTS_PATH = 'AGENTS.md';

/**
 * Writes the contract into `root`. The CLI and the web button both come here,
 * so the two cannot install different things.
 *
 * Only ever touches the two paths above — this is the one place the tool writes
 * something that is not a document the editor opened, and it stays that narrow
 * on purpose.
 *
 * @param {string} root
 * @param {{claude?: boolean, codex?: boolean, force?: boolean}} options
 * @returns {Promise<Array<{target: 'claude'|'codex', path: string, action: string, note?: string}>>}
 */
export async function installAgentFiles(root, { claude = true, codex = true, force = false } = {}) {
    const report = [];

    if (claude) {
        const file = path.join(root, CLAUDE_COMMAND_PATH);
        const exists = existsSync(file);
        if (exists && !force) {
            report.push({
                target: 'claude',
                path: CLAUDE_COMMAND_PATH,
                action: 'kept',
                note: 'already there — a customised one is not overwritten',
            });
        } else {
            await mkdir(path.dirname(file), { recursive: true });
            await writeFile(file, claudeCommand(), 'utf8');
            report.push({ target: 'claude', path: CLAUDE_COMMAND_PATH, action: exists ? 'replaced' : 'written' });
        }
    }

    if (codex) {
        const file = path.join(root, CODEX_AGENTS_PATH);
        const existing = existsSync(file) ? await readFile(file, 'utf8') : '';
        const { content, action } = upsertSection(existing, agentsSection());
        if (action === 'unchanged') {
            report.push({ target: 'codex', path: CODEX_AGENTS_PATH, action: 'kept', note: 'its section is current' });
        } else {
            await writeFile(file, content, 'utf8');
            report.push({ target: 'codex', path: CODEX_AGENTS_PATH, action });
        }
    }

    return report;
}
