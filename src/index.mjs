// Public surface, for scripts and agents that would rather import than shell
// out to the CLI.
export { parseMentions, insertMention, removeMention, removeAllMentions, newMentionId, sanitizePrompt } from './mentions.mjs';
export { buildTree, flattenFiles, rootIndex } from './tree.mjs';
export { resolveInRoot, markdownTarget, mimeFor, hrefFor, MIME } from './paths.mjs';
export { collectMentions } from './collect.mjs';
export { startServer } from './server/server.mjs';
