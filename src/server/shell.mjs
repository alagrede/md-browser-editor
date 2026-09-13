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
      <button id="show-agent" class="link-button" title="Set up an AI agent to apply the mentions">Agent setup</button>
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
<div id="agent-panel" hidden>
  <header>
    <strong>Agent setup</strong>
    <button id="close-agent" class="icon-button" title="Close">✕</button>
  </header>
  <div class="panel-body">
    <p class="panel-text">
      A mention is an instruction you leave on a passage. A coding agent reads them all,
      applies each one to the passage between its markers, then drops the markers to say it is done.
      Teaching it that loop is one file per agent, and this writes them
      into <code id="agent-root">the served directory</code>.
    </p>

    <div class="agent-target" data-target="claude">
      <div class="agent-target-head">
        <strong>Claude Code</strong>
        <span class="agent-state" data-state="claude">checking…</span>
      </div>
      <p class="panel-text">
        <code>.claude/commands/mentions.md</code> — the loop becomes <code>/mentions</code>.
      </p>
      <button class="button install-agent" data-install="claude">Install</button>
    </div>

    <div class="agent-target" data-target="codex">
      <div class="agent-target-head">
        <strong>Codex</strong>
        <span class="agent-state" data-state="codex">checking…</span>
      </div>
      <p class="panel-text">
        A managed section in <code>AGENTS.md</code>, which it reads on its own — it has no
        project-level slash commands. Your own <code>AGENTS.md</code> is appended to, never replaced.
      </p>
      <button class="button install-agent" data-install="codex">Install</button>
    </div>

    <p class="panel-note" id="agent-result"></p>

    <p class="panel-text">The same thing from a terminal, where you can aim it anywhere:</p>
    <pre class="panel-code"><code>npx md-browser-editor init-agent .
npx md-browser-editor init-agent . --claude
npx md-browser-editor init-agent . --print</code></pre>

    <p class="panel-note">
      The button writes into the directory being served. If that directory is a mirror some
      sync tool rewrites, put these files in the project root above it instead — a file the
      sync did not create gets reported as an orphan at every pull.
    </p>

    <p class="panel-text">Then, once you have left a mention or two:</p>
    <pre class="panel-code"><code>claude        → /mentions
codex         → "Applique les mentions"</code></pre>
  </div>
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
