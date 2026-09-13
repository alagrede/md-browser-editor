# Getting started

Run the server on any directory of markdown:

```sh
npx md-browser-editor serve ./docs --open
```

## Leaving a mention

Select a passage, press ⌘M, and type what you want done with it. The editor
writes a pair of HTML comments around the selection:

<!--ai:demo Résume cette partie en deux phrases-->
The mention is stored in the document itself, which is what makes it survive a
rename, show up in a git diff, and reach an agent that only ever opens the
file. Nothing else has to be kept in sync, because there is nothing else.
<!--/ai:demo-->

An agent then reads them all at once:

```sh
md-browser-editor mentions ./docs --json
```

## What this is not

No code execution, no plugins, no database. It reads and writes `.md` files.
