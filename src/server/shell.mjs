// The page the browser loads. Everything else — the tree, the editor, the
// mention UI — is the bundle's job; this is the frame it mounts into.

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export function renderShell({ title, root }) {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/app.css" />
</head>
<body>
<div id="app">
  <aside id="sidebar">
    <header class="sidebar-head">
      <span class="root-name" title="${escapeHtml(root)}">${escapeHtml(title)}</span>
      <button id="new-file" class="icon-button" title="New markdown file">＋</button>
    </header>
    <nav id="tree" aria-label="Files"></nav>
    <footer class="sidebar-foot">
      <button id="show-mentions" class="link-button">Mentions <span id="mention-count">0</span></button>
    </footer>
  </aside>
  <main id="main">
    <header id="toolbar">
      <span id="current-path" class="current-path">No file open</span>
      <span id="status" class="status"></span>
      <span class="spacer"></span>
      <button id="add-mention" class="button" title="Annotate the selection for an AI agent (⌘M)" disabled>＠ Mention</button>
    </header>
    <div id="editor"></div>
    <div id="empty-state">Pick a file on the left, or create one with ＋.</div>
  </main>
</div>
<div id="mentions-panel" hidden>
  <header>
    <strong>Mentions</strong>
    <button id="close-mentions" class="icon-button" title="Close">✕</button>
  </header>
  <div id="mentions-list"></div>
  <p class="hint">An agent reads these with <code>md-browser-editor mentions --json</code>, edits the passage, then drops the markers.</p>
</div>
<script src="/app.js" type="module"></script>
</body>
</html>`;
}
