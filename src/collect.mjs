// Every mention of every document under a root — what an agent reads to know
// what it has been asked to do.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildTree, flattenFiles, rootIndex } from './tree.mjs';
import { parseMentions } from './mentions.mjs';

/**
 * @returns {Promise<Array<{file: string, id: string, scope: 'passage'|'file',
 *                          prompt: string, text: string, line: number,
 *                          unterminated: boolean}>>}
 *   `file` is root-relative; `line` is 1-based, pointing at the opening marker.
 *   A `file` mention is about the whole document, and carries no `text`.
 */
export async function collectMentions(root) {
    // The root's index.md keeps its own row in the tree, so flattenFiles already
    // has it: adding it again listed every one of its mentions twice, and made
    // the count say two where there was one.
    const rootPage = await rootIndex(root);
    const files = [...new Set([...(rootPage ? [rootPage] : []), ...flattenFiles(await buildTree(root))])];
    const found = [];

    for (const relative of files) {
        let source;
        try {
            source = await readFile(path.join(root, relative), 'utf8');
        } catch {
            continue; // vanished between the walk and the read
        }
        if (!source.includes('<!--ai:')) continue; // cheap reject before the regex

        for (const mention of parseMentions(source)) {
            found.push({
                file: relative,
                id: mention.id,
                scope: mention.scope,
                prompt: mention.prompt,
                text: mention.text,
                line: source.slice(0, mention.from).split('\n').length,
                unterminated: mention.unterminated,
            });
        }
    }

    return found;
}
