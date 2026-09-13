---
description: Apply the mentions left in the markdown, then drop their markers
---

Apply the mentions left in this directory's markdown documents.

A mention is an instruction attached to a passage, stored in the document
itself as a pair of HTML comments:

```markdown
<!--ai:a3f Reformule ça, trop jargonneux-->
…the passage it applies to…
<!--/ai:a3f-->
```

Applying them:

1. Run `npx md-browser-editor mentions . --json` to read them all.
2. For each mention, apply its `prompt` to the passage **between its markers**,
   and only to that passage. Edit the file in place.
3. Drop that mention's markers once it is done:
   `npx md-browser-editor mentions . --resolve <id>`. Leaving them in place
   means the request is still open, so an unresolved marker is how you say "I
   did not do this one".
4. When every mention is handled, run `npx md-browser-editor mentions .` again
   and report what is left.

Rules:

- Change nothing outside the marked passages. A mention is not an invitation to
  tidy the rest of the document.
- Keep the document's language: answer in the language the passage is written in.
- A mention reported as `unterminated` has an opening marker and no closing one,
  so it annotates nothing. Do not guess its extent — report it and move on.
- If a prompt is ambiguous enough that two readings would produce different text,
  say so instead of picking one.
- If the directory is a git repository, leave the work as a reviewable diff and
  do not commit. If it is not, say so before you start: without git there is no
  undo for what you are about to rewrite.
- The editor may be open on these files while you work. It follows them: a
  document nobody is editing reloads itself, and a save that would land on top
  of your work is refused. You do not have to coordinate.

$ARGUMENTS
