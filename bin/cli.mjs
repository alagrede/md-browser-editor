#!/usr/bin/env node
// md-browser-editor — browse and edit a markdown tree in the browser, and
// leave mentions for an AI agent to act on.
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentsSection, claudeCommand, MENTIONS_COMMAND_NAME, upsertSection } from '../src/agentPrompt.mjs';
import { parseArgs, UsageError } from '../src/args.mjs';
import { collectMentions } from '../src/collect.mjs';
import { removeAllMentions, removeMention } from '../src/mentions.mjs';
import { startServer } from '../src/server/server.mjs';
import { mkdir, writeFile } from 'node:fs/promises';

const USAGE = `md-browser-editor — read and edit a markdown tree in your browser.

Usage: md-browser-editor <command> [options]

Commands:
  serve [dir]      serve <dir> (default: the current directory) and open the editor
  mentions [dir]   list the mentions left for an AI agent
  init-agent [dir] teach the coding agents in <dir> how to apply those mentions

Run \`md-browser-editor <command> --help\` for a command's options.

A mention is a passage of a document plus what you want done with it. It is
stored in the markdown itself:

    <!--ai:a3f Reformule ça-->…the passage…<!--/ai:a3f-->

so the instruction travels with the text it applies to.
`;

const SERVE_USAGE = `Usage: md-browser-editor serve [dir] [options]

Options:
  --port <n>   port to listen on (default 4830; incremented if busy)
  --host <h>   interface to bind (default 127.0.0.1)
  --open       open the browser once listening
`;

const MENTIONS_USAGE = `Usage: md-browser-editor mentions [dir] [options]

Lists every mention under <dir>, for a human or an agent to act on.

Options:
  --json           machine-readable output
  --file <path>    only mentions of that file (root-relative)
  --resolve <id>   drop that mention's markers, keeping its text
  --resolve-all    drop every mention's markers

Exit code 1 when --resolve finds no such mention.
`;

const INIT_AGENT_USAGE = `Usage: md-browser-editor init-agent [dir] [options]

Writes the "apply the mentions" contract where a coding agent working in <dir>
will find it:

  Claude Code   .claude/commands/${MENTIONS_COMMAND_NAME}.md — the loop becomes /${MENTIONS_COMMAND_NAME}
  Codex         a managed section in AGENTS.md, which it reads on its own
                (it has no project-level slash commands)

Both, unless you ask for one. Safe to re-run: the AGENTS.md section is replaced
in place, and whatever else that file holds is left alone.

Options:
  --claude     only the Claude Code command
  --codex      only the AGENTS.md section
  --force      overwrite an existing .claude command file
  --print      write nothing, print what would be written
`;

async function initAgentCommand(argv) {
    const args = parseArgs(argv, { flags: ['--claude', '--codex', '--force', '--print', '--help'] });
    if (args.has('--help')) return void console.log(INIT_AGENT_USAGE);

    const root = resolveRoot(args.positionals);
    const both = !args.has('--claude') && !args.has('--codex');
    const wantClaude = both || args.has('--claude');
    const wantCodex = both || args.has('--codex');

    if (args.has('--print')) {
        if (wantClaude) console.log(`--- .claude/commands/${MENTIONS_COMMAND_NAME}.md ---\n\n${claudeCommand()}`);
        if (wantCodex) console.log(`--- AGENTS.md (section) ---\n\n${agentsSection()}\n`);
        return;
    }

    const done = [];

    if (wantClaude) {
        const file = path.join(root, '.claude', 'commands', `${MENTIONS_COMMAND_NAME}.md`);
        const exists = existsSync(file);
        if (exists && !args.has('--force')) {
            console.log(`Kept  ${path.relative(root, file)} (already there — --force to replace it)`);
        } else {
            await mkdir(path.dirname(file), { recursive: true });
            await writeFile(file, claudeCommand(), 'utf8');
            done.push(`${exists ? 'Replaced' : 'Wrote'} ${path.relative(root, file)} → /${MENTIONS_COMMAND_NAME}`);
        }
    }

    if (wantCodex) {
        const file = path.join(root, 'AGENTS.md');
        const existing = existsSync(file) ? await readFile(file, 'utf8') : '';
        const { content, action } = upsertSection(existing, agentsSection());
        if (action === 'unchanged') {
            console.log('Kept  AGENTS.md (its mentions section is already current)');
        } else {
            await writeFile(file, content, 'utf8');
            const said = { created: 'Wrote', appended: 'Added a section to', updated: 'Updated the section in' }[action];
            done.push(`${said} AGENTS.md`);
        }
    }

    for (const line of done) console.log(line);
    if (done.length) {
        console.log(`\nLeave mentions in your markdown, then ask the agent for them` +
            `${wantClaude ? ` — /${MENTIONS_COMMAND_NAME} in Claude Code` : ''}.`);
    }
}

function resolveRoot(positionals) {
    const root = path.resolve(positionals[0] ?? '.');
    if (!existsSync(root) || !statSync(root).isDirectory()) {
        throw new UsageError(`Not a directory: ${root}`);
    }
    return root;
}

async function serveCommand(argv) {
    const args = parseArgs(argv, { flags: ['--open', '--help'], options: ['--port', '--host'] });
    if (args.has('--help')) return void console.log(SERVE_USAGE);

    const root = resolveRoot(args.positionals);
    const port = args.options.port ? Number(args.options.port) : 4830;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new UsageError(`--port expects a port number, got "${args.options.port}".`);
    }

    const server = await startServer({ root, host: args.options.host ?? '127.0.0.1', port });
    console.log(`\nEditing ${root}\n  → ${server.url}\n`);
    console.log('Ctrl+C to stop.');

    if (args.has('--open')) {
        const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
        spawn(opener, [server.url], { stdio: 'ignore', detached: true }).unref();
    }
}

async function mentionsCommand(argv) {
    const args = parseArgs(argv, {
        flags: ['--json', '--resolve-all', '--help'],
        options: ['--file', '--resolve'],
    });
    if (args.has('--help')) return void console.log(MENTIONS_USAGE);

    const root = resolveRoot(args.positionals);
    let mentions = await collectMentions(root);
    if (args.options.file) {
        const wanted = args.options.file.replace(/^\.?\//, '');
        mentions = mentions.filter(mention => mention.file === wanted);
    }

    if (args.options.resolve) {
        const target = mentions.find(mention => mention.id === args.options.resolve);
        if (!target) {
            console.error(`No mention with id "${args.options.resolve}".`);
            process.exitCode = 1;
            return;
        }
        const file = path.join(root, target.file);
        await writeFile(file, removeMention(await readFile(file, 'utf8'), target.id), 'utf8');
        console.log(`Resolved ${target.id} in ${target.file}.`);
        return;
    }

    if (args.has('--resolve-all')) {
        const files = [...new Set(mentions.map(mention => mention.file))];
        for (const relative of files) {
            const file = path.join(root, relative);
            await writeFile(file, removeAllMentions(await readFile(file, 'utf8')), 'utf8');
        }
        console.log(`Resolved ${mentions.length} mention(s) in ${files.length} file(s).`);
        return;
    }

    if (args.has('--json')) {
        console.log(JSON.stringify({ root, mentions }, null, 2));
        return;
    }

    if (!mentions.length) {
        console.log('No mention.');
        return;
    }

    for (const mention of mentions) {
        const excerpt = mention.text.replace(/\s+/g, ' ').trim();
        console.log(`\n${mention.file}:${mention.line}  [${mention.id}]`);
        console.log(`  ${mention.prompt || '(no instruction)'}`);
        if (mention.unterminated) console.log('  ⚠ opening marker with no closing one — it annotates nothing');
        else console.log(`  > ${excerpt.length > 120 ? `${excerpt.slice(0, 120)}…` : excerpt}`);
    }
    console.log(`\n${mentions.length} mention(s).`);
}

async function main() {
    const [command, ...rest] = process.argv.slice(2);

    if (!command || command === '--help' || command === '-h' || command === 'help') {
        console.log(USAGE);
        return;
    }
    if (command === '--version' || command === '-v') {
        const manifest = JSON.parse(await readFile(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
        console.log(manifest.version);
        return;
    }

    if (command === 'serve') return serveCommand(rest);
    if (command === 'mentions') return mentionsCommand(rest);
    if (command === 'init-agent') return initAgentCommand(rest);

    throw new UsageError(`Unknown command: ${command}`);
}

main().catch(error => {
    if (error instanceof UsageError) {
        console.error(`${error.message}\n`);
        console.error(USAGE);
        process.exit(2);
    }
    console.error(error.stack ?? error.message);
    process.exit(1);
});
