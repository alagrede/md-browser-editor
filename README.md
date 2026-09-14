# md-browser-editor

[![npm](https://img.shields.io/npm/v/md-browser-editor?color=%232563eb&label=npm)](https://www.npmjs.com/package/md-browser-editor)

**A markdown editor for a folder you already have.** Point it at a directory,
get an explorer tree and a live-preview editor in your browser — tables that
render as tables, frontmatter as a properties panel, highlighted code, the
shortcuts you expect. Files stay plain markdown on disk.

And for the edits you would rather not type yourself, leave a **mention**:
select a passage, say what should be done with it, and an AI agent — Claude
Code, Codex — reads the instruction, makes the change, and clears the mark.

```sh
npx md-browser-editor serve ./docs --open
```

That is the whole setup. No config file, no database, no build step — the
directory you point at is the state.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/alagrede/md-browser-editor/main/docs/screenshots/editor-dark.png">
  <img alt="The editor: explorer tree, properties panel, a rendered table" src="https://raw.githubusercontent.com/alagrede/md-browser-editor/main/docs/screenshots/editor-light.png">
</picture>

**Node ≥ 18, and no runtime dependencies.** The server imports only `node:*`
builtins; CodeMirror is bundled into a single committed file, so `npx` works
with nothing to install.

## Editing

One pane, in live preview: markdown renders in place, and the source of
whatever the caret sits in comes back so it stays editable — headings, bold,
italics, inline code, links, images, quotes, lists, rules. The Obsidian/Znote
model rather than a split view, because reading and editing the same words in
the same place is the point.

| | |
| --- | --- |
| Save | automatic, ~1s after you stop typing — or ⌘S |
| New file | ＋ in the sidebar, path relative to the served directory |
| Format | ⌘B, ⌘I, ⌘E (code), ⌘⇧X (strikethrough), ⌘K (link) |
| Turn into | ⌘1 ⌘2 ⌘3 (headings), ⌘⇧8 ⌘⇧7 ⌘⇧9 (bullet, numbered, task), ⌘⇧' (quote) |
| Insert | right-click → image, table, code block, divider |
| Mention | select a passage, ⌘M |
| Everything at once | right-click anywhere in the text |

Every formatting command is a **toggle**: ⌘B on bold text takes the bold off,
and a heading 2 on a heading 2 gives you a paragraph back. Enter continues a
list or a quote. Right-click opens the same actions and moves the caret to
where you clicked first, so the command lands where you are looking.

![The right-click menu: format, turn into, insert](https://raw.githubusercontent.com/alagrede/md-browser-editor/main/docs/screenshots/context-menu.png)

**Tables render as tables, and are edited as tables.** Click a cell to edit it
(the input holds the raw markdown of that cell), Tab for the next one, ＋ to add
a row or a column; the header cell carries a ✕ to drop its column and a button
to cycle its alignment. Every edit is serialized straight back into the file.

**Frontmatter is a Properties panel, not a heading.** A markdown parser reads
`title: Guide` followed by `---` as a *setext heading*, so an unhandled
frontmatter opens the document with a giant title made of its own metadata.
Here the `---` block renders as key/value rows (lists become chips), and
clicking it brings the raw YAML back.

**Documents are named by their title** — frontmatter `title`, else the first
level-1 heading, else the file name, so `02-installation.md` reads as
"Installation". Ordering still follows the *file* name, which is the only lever
left once file names stop being displayed. A directory with an `index.md` **is**
that page: the folder row opens it, and only the chevron folds the children.

**Fenced code is highlighted**: JavaScript, TypeScript, JSON, CSS, HTML, shell,
YAML, Python, SQL, XML, diff, Dockerfile and TOML. An unknown info string is not
an error — the block simply stays plain.

**Every document has an address.** Opening one puts it in the URL, so a refresh
lands back on it and Back/Forward walk the documents you opened.
`[Guide](../guide.md)` opens that document in the editor, `page.md#a-heading`
scrolls there, and anything else (http, mailto, a PDF) opens in a new tab —
following a link never replaces the editor, which would take an unsaved buffer
with it.

Files are written back as plain markdown with exactly one trailing newline —
they live in git, and a missing one shows up in every diff.

<details>
<summary>Two details worth knowing</summary>

**Image paths are relative to their document.** `![](assets/shot.png)` in
`guide/index.md` is served from `guide/assets/shot.png`, not from the root — the
page URL is `/` whatever is open, so a browser left to itself resolves relative
paths against the root, which is a quiet wrong answer in a tree where several
folders have their own `assets/`. `../`, an already-encoded `%20` and a
root-absolute `/assets/…` all work; a reference that misses falls back once to
the root before showing as broken.

**Clicking a link follows it** rather than placing the caret in its text. To
edit the text, use the arrow keys, or ⌘K on a selection.

The sidebar is resizable — drag its edge, double-click to reset; the width is
remembered per browser.

</details>

## Mentions — marking up work for an AI agent

**A mention is a to-do for an agent, attached to the text it applies to.**

You are reading a document and you see the work: a paragraph too jargon-heavy, a
section that should be summarised, a procedure that is out of date, a whole page
that needs rewriting for a different audience. You do not want to type it now,
and a ticket saying "page 4, second paragraph" is a bad way to say where.

So you mark it instead. Select the passage — or ⌘A for the whole file — press
**⌘M**, and write what should be done with it. Then **Claude Code or Codex reads
your marks, makes the edits, and removes them.** You review the diff.

```
you     select the passage, ⌘M, "Rephrase this, too much jargon"
agent   /mentions            — reads every instruction and the text it points at
agent   rewrites the passage — and removes the marks to say it is done
you     git diff             — and keep it, or ask again
```

The mark is stored **in the document**, as a pair of HTML comments around the
passage:

```markdown
<!--ai:a3f Rephrase this, too much jargon-->
The service exposes an idempotent endpoint that reconciles divergent states.
<!--/ai:a3f-->
```

HTML comments render as nothing, here and in every other markdown tool. Keeping
them in the file rather than in a sidecar buys four things: the anchor never
drifts (the text moves, its markers move with it), the instruction sits exactly
where it applies, it survives a rename, and it shows up in a `git diff`.

In the editor those markers fold away — you see the passage highlighted with the
instruction as a pill, and a panel lists every mention in the tree, so "what is
left to do in this documentation" is one click away. Click a pill to resolve a
mention yourself. The instruction is free text, in whatever language you think
in — `<!--ai:b7 Résume ça en deux phrases-->` works as well as the English above,
and the agent is told to answer in the language of the *passage*.

![The mentions panel, listing every pending instruction](https://raw.githubusercontent.com/alagrede/md-browser-editor/main/docs/screenshots/mentions.png)

### What an agent does with them

```sh
md-browser-editor mentions ./docs --json
```

```json
{
  "file": "guide/page.md",
  "id": "a3f",
  "prompt": "Rephrase this, too much jargon",
  "text": "The service exposes an idempotent endpoint…",
  "line": 14
}
```

The contract is three steps: **read** the mentions, **edit** the passage between
the markers, **drop** the markers to say it is done — by deleting the two
comments, or with `mentions ./docs --resolve a3f` (`--resolve-all` for every
one). An unresolved marker is how an agent says "I did not do this one".

One command writes that contract where Claude Code and Codex read it:

```sh
npx md-browser-editor init-agent .          # both
npx md-browser-editor init-agent . --claude # just the slash command
npx md-browser-editor init-agent . --print  # write nothing, show it
```

Claude Code gets `.claude/commands/mentions.md`, so the loop becomes
`/mentions`. Codex gets a managed section in `AGENTS.md`, which it reads on its
own — the section sits between two comment markers, so re-running replaces it in
place and an `AGENTS.md` you already wrote is appended to, never replaced. The
sidebar's **Agent setup** panel does the same in one click, and says what is
already installed before you click.

Aim it at the directory the agent will run in, which is not always the one you
serve: in a mirror that a sync tool rewrites, a file the tool did not put there
is reported as an orphan at every pull.

### While an agent is working

The editor follows the files. A document you are not editing **reloads itself**
when something rewrites it, and the tree and the mention count follow — so you
watch the pills disappear one by one.

If you *were* editing it, nothing is thrown away: the save is **refused** by the
server (the browser sends back the mtime it read) and you choose which version
survives, with both in hand. Without that, whoever wrote last would win
silently, and it would usually be the editor flushing a buffer that predates the
agent's work.

## Install

Nothing is required — `npx` fetches the package, runs it, and leaves your
project alone. Install it when you are tired of the wait, or when you want it in
a `package.json` where the team will see it.

```sh
npx md-browser-editor serve ./docs --open          # no install at all
npm install --global md-browser-editor             # then: md-browser-editor …
npm install --save-dev md-browser-editor           # in a project
```

As a project dependency, wiring it into `scripts` is what makes it habitual:

```json
{
    "scripts": {
        "docs": "md-browser-editor serve ./docs --open",
        "docs:mentions": "md-browser-editor mentions ./docs"
    }
}
```

### Updating

```sh
md-browser-editor --version            # what you are running
npm view md-browser-editor version     # what is published

npm install --global md-browser-editor@latest   # a global install
npm update md-browser-editor                    # a project one, within its range
npx md-browser-editor@latest serve ./docs       # no install: pin it to latest
```

One thing that looks like a stale cache and is not: `npx` runs a copy it already
has — the project's `node_modules/.bin` first, then a global install — and only
fetches when it finds none. So `npx md-browser-editor` next to a global install
runs *that* version, however old. Naming `@latest` makes the question
unambiguous.

## The commands

| Command | What it does |
| --- | --- |
| `serve [dir]` | serve the tree and the editor (default: the current directory) |
| `mentions [dir]` | list, filter or resolve the mentions |
| `init-agent [dir]` | write the agent contract where Claude Code and Codex read it |

```
serve     --port <n>   port to listen on (default 4830; incremented if busy)
          --host <h>   interface to bind (default 127.0.0.1)
          --open       open the browser once listening

mentions  --json           machine-readable output
          --file <path>    only that file's mentions
          --resolve <id>   drop one mention's markers, keeping its text
          --resolve-all    drop every mention's markers

init-agent --claude       only .claude/commands/mentions.md
           --codex        only the AGENTS.md section
           --force        replace an existing command file
           --print        write nothing, print what would be written
```

`--help` on either prints the same. Unknown options are refused rather than
ignored — a silently swallowed typo is how you end up serving the wrong
directory.

## What it will not do

The server binds `127.0.0.1`, and these rules are why it is comfortable to run
over a directory you care about:

- **Writes are markdown only** — no dropping a `.js`, an `.html` or a
  `.command` next to your documents.
- **Reads are an allowlist** — images, PDF, JSON, txt and csv; an unknown
  extension is a 404, never a download of whatever it happens to be.
- **Dotted segments are refused** on every path, so `.env`, `.git/` and `.ssh/`
  stay unreachable whatever the root is.
- **No code execution** — no plugins, no shell, no eval. A fenced block is text
  with a background.
- **No rename, move or delete** from the browser. Those belong to your file
  manager and your git history.

There is no authentication, so `--host 0.0.0.0` is for a demo on a network you
trust and nothing more.

<details>
<summary>Accepted limits</summary>

- **A table is recognised by its GFM shape**: a row, then a delimiter row with
  the same number of cells. That second rule keeps prose containing a pipe from
  turning into a table; a hand-written table whose delimiter row is the wrong
  width stays as text, visibly.
- **A rendered table has no raw view.** It is edited through its cells. Nothing
  is lost — the markdown is rewritten from the cells on every change — but a
  hand-crafted alignment row comes back normalized.
- **The language list is curated, not exhaustive.** Bundling every mode
  CodeMirror knows would triple the download. Adding one is three lines in
  `client/code-languages.js`.
- **Frontmatter parsing covers the flat shape**, which is what frontmatter
  actually has: scalars, quoted strings, inline `[a, b]` and block `- item`
  lists. A nested map is marked as such and edited as raw YAML.
- **One mention cannot contain another.** Overlapping instructions are a
  conversation, not an annotation.
- **The server is a local process**, and it dies the way local processes do:
  Ctrl+C, a closed terminal, a laptop that slept. The page stays up, so the
  editor watches its own event stream and says so in a banner — with the command
  to start it again — instead of letting every click fail quietly.
- **Reload needs an open tab.** The stream is server-sent events; a browser that
  cannot open one falls back to what it had, and the save refusal still protects
  the file.

</details>

## Use it as a library

Everything the CLI and the editor use is exported, and the mention functions are
pure string → string:

```js
import { parseMentions, insertMention, removeMention, collectMentions } from 'md-browser-editor';

const { id, source } = insertMention(markdown, from, to, 'Résume cette partie');
const pending = await collectMentions('./docs');
```

`startServer({ root, port, host })` gives the same server the CLI runs, and
resolves once it is listening.

## Contributing

```sh
git clone https://github.com/alagrede/md-browser-editor.git
cd md-browser-editor
npm install          # CodeMirror + esbuild, both build-time only
npm test             # 78 tests, node --test, no framework
npx . serve examples/docs --open
```

Anything under `client/` needs `npm run build` before it reaches the browser:
`public/app.js` is committed on purpose so the package runs with no install, and
`prepublishOnly` rebuilds it anyway so a published version can never carry a
stale bundle.

<details>
<summary>Releasing</summary>

```sh
npm version patch          # or minor / major — bumps, commits, tags
npm publish --otp=<code>   # prepublishOnly runs the build and the tests first
git push --follow-tags
```

Nothing reaches npm if the build or a test fails. The version in `package.json`
and the tag in git are the same thing said twice, which is why `npm version`
writes both.

</details>

## License

MIT
