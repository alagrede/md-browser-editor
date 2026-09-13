// Writing into AGENTS.md means writing into a file the project owns. The rules
// below are what makes that acceptable.
import assert from 'node:assert/strict';
import test from 'node:test';
import { agentsSection, claudeCommand, upsertSection } from '../src/agentPrompt.mjs';

test('the Claude command carries its frontmatter and the argument hook', () => {
    const command = claudeCommand();
    assert.match(command, /^---\ndescription: /);
    assert.match(command, /\$ARGUMENTS\n$/);
    assert.match(command, /mentions \. --json/);
});

test('an empty or missing AGENTS.md is created', () => {
    assert.equal(upsertSection('', agentsSection()).action, 'created');
    assert.equal(upsertSection(undefined, agentsSection()).action, 'created');
});

test('an existing AGENTS.md is appended to, never replaced', () => {
    const mine = '# Notre projet\n\nRègle maison: pas de commit direct sur main.\n';
    const { content, action } = upsertSection(mine, agentsSection());

    assert.equal(action, 'appended');
    assert.match(content, /Règle maison/, 'what was there stays there');
    assert.match(content, /## Mentions in the markdown/);
});

test('running it twice replaces the section instead of stacking copies', () => {
    const first = upsertSection('# Projet\n', agentsSection()).content;
    const second = upsertSection(first, agentsSection());

    assert.equal(second.action, 'unchanged');
    assert.equal(second.content.match(/## Mentions in the markdown/g).length, 1);

    // …and a newer version of the section lands in place of the old one.
    const changed = upsertSection(first, '<!-- md-browser-editor:mentions -->\nNEW\n<!-- /md-browser-editor:mentions -->');
    assert.equal(changed.action, 'updated');
    assert.match(changed.content, /NEW/);
    assert.equal(changed.content.includes('## Mentions in the markdown'), false);
    assert.match(changed.content, /# Projet/, 'the project’s own text is still untouched');
});
