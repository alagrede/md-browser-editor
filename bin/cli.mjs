#!/usr/bin/env node
// md-browser-editor — browse and edit a markdown tree in the browser, and
// leave mentions for an AI agent to act on.
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, UsageError } from '../src/args.mjs';
import { collectMentions } from '../src/collect.mjs';
import { removeAllMentions, removeMention } from '../src/mentions.mjs';
import { startServer } from '../src/server/server.mjs';
import { writeFile } from 'node:fs/promises';

const USAGE = `md-browser-editor — read and edit a markdown tree in your browser.

Usage: md-browser-editor <command> [options]

Commands:
  serve [dir]     serve <dir> (default: the current directory) and open the editor
  mentions [dir]  list the mentions left for an AI agent

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
