# md-browser-editor

Point it at a directory of markdown. It serves an explorer tree and a
live-preview editor in your browser, and lets you leave **mentions** — a
passage plus what you want an AI agent to do with it.

```
docs/                 ──serve──▶   tree + editor in the browser
  guide/page.md                          │
                                         │  select a passage, ⌘M
                                         ▼
                          <!--ai:a3f Rephrase this-->…<!--/ai:a3f-->
                                         │
                         mentions --json │  an agent reads, edits, resolves
```

**Node ≥ 18, and no runtime dependencies.** The server imports only `node:*`
builtins; CodeMirror is bundled into a single committed file, so `npx` works
with nothing to install and nothing to fetch.

## Quickstart

```sh
npx md-browser-editor serve ./docs --open
```

That is the whole setup. No config file, no database, no build step — the
directory you point at is the state.

```sh
npx md-browser-editor serve examples/docs --open   # the sample tree, from a clone
```

## The editor

One pane, in live preview: markdown renders in place, and the source of
whatever the caret sits in comes back so it stays editable — headings, bold,
italics, inline code, links, images, quotes, lists, rules. It is the
Obsidian/Znote model rather than a split view, because reading and editing the
same words in the same place is the point.

**Tables render as tables, and are edited as tables.** Click a cell to edit it
(the input holds the raw markdown of that cell), Tab to move to the next one,
＋ to add a row or a column, and the header cell carries a ✕ to drop its column
and a button to cycle its alignment — the delimiter row is not reachable any
other way once the table is rendered. Every edit is serialized straight back
into the document, so the file stays the only state.

**Image paths are relative to their document.** `![](assets/shot.png)` in
`guide/index.md` is served from `guide/assets/shot.png`, not from the root —
the page URL is `/` whatever is open, so a browser left to itself resolves
every relative path against the root, which is a quiet wrong answer in a tree
where several folders have their own `assets/`. `../`, an already-encoded
`%20`, and a root-absolute `/assets/…` all work; a reference that misses falls
back once to the root before showing as broken.

**Frontmatter is a Properties panel, not a heading.** A markdown parser reads
`title: Guide` followed by `---` as a *setext heading*, so an unhandled
frontmatter opens the document with a giant title made of its own metadata.
Here the `---` block renders as a key/value panel (lists become chips), and
clicking it brings the raw YAML back — the only honest way to edit a shape the
panel does not fully model. A nested value is shown as nested rather than
flattened into something that looks right and is not.

**Documents are named by their title.** The tree shows a page's frontmatter
`title`, else its first level-1 heading, else its file name — so
`02-installation.md` reads as "Installation". Ordering still follows the *file*
name: a numeric prefix is the only lever an author has left once file names
stop being displayed.

The sidebar is **resizable** — drag its edge, double-click to reset. Real
document titles are long, and 280px was a guess; the width is remembered per
browser.

**A directory with an `index.md` is that page.** The folder row opens it
instead of listing it inside itself under a name that says nothing, and only
the chevron folds the children. The same goes for the root: its `index.md` is
what opens on arrival, and the tree's title bar opens it again. A folder whose
only markdown is its index is still a page, not an empty folder.

**Fenced code is highlighted**: JavaScript, TypeScript, JSON, CSS, HTML, shell,
YAML, Python, SQL, XML, diff, Dockerfile and TOML. An unknown info string is not
an error — the block simply stays plain.

| | |
| --- | --- |
| Save | automatic, ~1s after you stop typing — or ⌘S |
| New file | ＋ in the sidebar, path relative to the served directory |
| Mention | select a passage, ⌘M |
| Resolve a mention | click its pill |
| Follow a link | click it |
| Format | ⌘B, ⌘I, ⌘E (code), ⌘⇧X (strikethrough), ⌘K (link) |
| Turn into | ⌘1 ⌘2 ⌘3 (headings), ⌘⇧8 ⌘⇧7 ⌘⇧9 (bullet, numbered, task), ⌘⇧' (quote) |
| Insert | right-click → image, table, code block, divider |
| Everything at once | right-click anywhere in the text |

Every formatting command is a **toggle**: ⌘B on bold text takes the bold off, and
asking for a heading 2 on a heading 2 gives you a paragraph back — a command that
only ever adds is one you undo by hand. Enter continues a list or a quote.

**A link between documents opens in the editor.** `[Accueil](../accueil.md)`
loads that document, `page.md#a-heading` loads it and scrolls there, and a bare
`#a-heading` jumps within the one you are reading — resolved against the
document's own folder, like an image. Anything else (http, mailto, a PDF) opens
in a new tab; following a link never replaces the editor, which would take an
unsaved buffer with it. The trade is that clicking a link follows it rather than
placing the caret in its text: use the arrow keys, or ⌘K on a selection.

Right-click opens the same actions, named the same way, and moves the caret to
where you clicked first — otherwise the command lands wherever the caret
happened to be. It replaces the browser's menu, so Cut and Copy are in it, and
the browser's own is still one **Shift**-right-click away.

Files are written back as plain markdown, with exactly one trailing newline —
they live in git, and a missing one shows up in every diff that touches the
last line.

## Mentions

A mention is an instruction attached to a passage, stored **in the document**:

```markdown
## Nouvelle section

<!--ai:a3f Rephrase this, too much jargon-->
The service exposes an idempotent endpoint that reconciles divergent states.
<!--/ai:a3f-->
```

HTML comments render as nothing, here and in every other markdown tool. Keeping
them in the file rather than in a sidecar buys four things: the anchor never
drifts (the text moves, its markers move with it), the instruction sits exactly
where it applies, it survives a rename, and it shows up in a `git diff`.

In the editor the markers fold away: you see the passage highlighted, with the
instruction as a pill. Click the pill to resolve it.

The instruction is free text, in whatever language you think in —
`<!--ai:b7 Résume ça en deux phrases-->` is as good as the English above, and
the contract tells the agent to answer in the language of the *passage*, not of
the instruction.

### While an agent is working

The editor follows the files. A document you are not editing **reloads itself**
when something rewrites it, and the tree and the mention count follow — so an
agent applying mentions is watched live, markers disappearing one by one.

If you *were* editing it, nothing is thrown away: the save is **refused** by the
server (the browser sends back the mtime it read), and you are asked which
version survives, with both in hand. That refusal is the point — without it,
whoever wrote last would win silently, and it would usually be the editor
flushing a buffer that predates the agent's work.

### What an agent does with them

```sh
md-browser-editor mentions ./docs            # human-readable
md-browser-editor mentions ./docs --json     # for an agent
```

```json
{
  "root": "/home/you/project/docs",
  "mentions": [
    {
      "file": "guide/page.md",
      "id": "a3f",
      "prompt": "Rephrase this, too much jargon",
      "text": "The service exposes an idempotent endpoint…",
      "line": 14,
      "unterminated": false
    }
  ]
}
```

The contract is three steps: **read** the mentions, **edit** the passage between
the markers, **drop** the markers to say it is done — either by deleting the two
comments or with:

```sh
md-browser-editor mentions ./docs --resolve a3f
md-browser-editor mentions ./docs --resolve-all
```

A prompt for Claude Code, or any agent that can read files, fits in a sentence:

> Run `md-browser-editor mentions . --json`, apply each instruction to the
> passage between its markers, then remove that mention's markers.

**From the editor**, the sidebar's *Agent setup* panel explains the loop and
installs both files into the directory being served, in one click each. It says
what is already there before you click, and re-clicking changes nothing.

Or one command, which can be aimed anywhere:

```sh
npx md-browser-editor init-agent .          # both
npx md-browser-editor init-agent . --claude # just the slash command
npx md-browser-editor init-agent . --print  # write nothing, show it
```

- **Claude Code** gets `.claude/commands/mentions.md`, so the loop becomes
  `/mentions`.
- **Codex** gets a managed section in `AGENTS.md`, which it reads on its own —
  it has no project-level slash commands. The section sits between two
  comment markers, so re-running replaces it in place and whatever else that
  file holds is left alone. An `AGENTS.md` you already wrote is appended to,
  never replaced.

Point it at the directory the agent will run in, which is not always the one
you serve: in a mirror that a sync tool rewrites, a file the tool did not put
there gets reported as an orphan at every pull. The project root above it is the
better place.

Both files carry the rules that matter: change nothing outside the marked
passages, keep the document's language, report an unterminated marker instead of
guessing its extent, say so when a prompt is ambiguous, and leave the work as a
diff.

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

The server binds `127.0.0.1`, and the rules below are the reason it is
comfortable to run over a directory you care about:

- **Writes are markdown only.** The write endpoints refuse any path that is not
  a `.md` under the served root — no dropping a `.js`, an `.html` or a
  `.command` next to your documents.
- **Reads are an allowlist.** Images, PDF, JSON, txt and csv are served; an
  unknown extension is a 404, never an `application/octet-stream` download of
  whatever it happens to be.
- **Dotted segments are refused** on every path, in or out, so `.env`, `.git/`
  and `.ssh/` stay unreachable whatever the root is.
- **No code execution.** No plugins, no shell, no eval — fenced code blocks are
  text that gets a background.

There is no authentication, so `--host 0.0.0.0` is for a demo on a network you
trust and nothing more.

## Accepted limits

- **A table is recognised by its GFM shape**: a row, then a delimiter row with
  the same number of cells. That second rule is what keeps prose containing a
  pipe from turning into a table; a hand-written table whose delimiter row is
  the wrong width stays as text, visibly.
- **A rendered table has no raw view.** It is edited through its cells, like
  in Znote. Nothing is lost — the markdown is rewritten from the cells on every
  change — but a hand-crafted alignment row comes back normalized.
- **The language list is curated, not exhaustive.** Bundling every mode
  CodeMirror knows would triple the download for languages documentation rarely
  contains. Adding one is three lines in `client/code-languages.js`.
- **Frontmatter parsing covers the flat shape**, which is what frontmatter
  actually has: scalars, quoted strings, inline `[a, b]` and block `- item`
  lists. A nested map is marked as such and edited as raw YAML. Pulling in a
  full YAML parser for the rest would cost more than it buys, in the bundle and
  in the reading.
- **One mention cannot contain another.** Overlapping instructions are a
  conversation, not an annotation.
- **The server is a local process**, and it dies the way local processes do:
  Ctrl+C, a closed terminal, a laptop that slept. The page stays up, so the
  editor watches its own event stream and says so in a banner — with the command
  to start it again — instead of letting every click fail quietly.
- **Reload needs an open tab.** The stream is server-sent events over the same
  connection; a browser that cannot open one (or a tab left in the background by
  an aggressive power saver) simply falls back to what it had — the save
  refusal still protects the file.
- **No rename, move or delete** from the browser. Those belong to your file
  manager and your git history, and a mis-click here would be silent.

## Use it as a library

Everything the CLI and the editor use is exported, and the mention functions
are pure string → string:

```js
import { parseMentions, insertMention, removeMention, collectMentions } from 'md-browser-editor';

const { id, source } = insertMention(markdown, from, to, 'Résume cette partie');
const pending = await collectMentions('./docs');
```

`startServer({ root, port, host })` gives the same server the CLI runs, and
resolves once it is listening.

## Contributing

```sh
npm install       # CodeMirror + esbuild, both build-time only
npm test          # node --test, no framework
npm run build     # client/ → public/app.js (commit the result)
```

Anything under `client/` needs `npm run build` before it reaches the browser:
`public/app.js` is committed on purpose so the package runs with no install.

## License

MIT
