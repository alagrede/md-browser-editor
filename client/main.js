// Wiring: the explorer, the editor, and the two actions that write —
// creating a file and leaving a mention.
//
// Saving is debounced and also bound to ⌘S. The editor never holds a document
// the server has not confirmed: a failed save leaves the buffer dirty and says
// so, rather than pretending.
import { Annotation, EditorState } from '@codemirror/state';
import { EditorView, keymap, highlightActiveLine, drawSelection, placeholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
// markdownLanguage, not the default base: the default is plain CommonMark,
// which has no tables and no strikethrough — their nodes never appear in the
// tree, so the decorations for them silently never fire.
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { codeLanguages } from './code-languages.js';
import { codeHighlighting } from './highlight.js';
import { tables, tableTheme } from './table.js';
import { frontmatter, frontmatterTheme } from './frontmatter.js';
import { docPath } from './doc-path.js';
import { api, RequestError } from './api.js';
import { livePreview, livePreviewTheme } from './live-preview.js';
import { editorTheme } from './theme.js';
import { mentionsTheme, mentionsView } from './mentions-view.js';
import { renderTree, revealFile, toggleDir } from './tree.js';
import { insertMention } from '../src/mentions.mjs';
import { askChoice, askText } from './ask.js';

const dom = {
    tree: document.getElementById('tree'),
    editor: document.getElementById('editor'),
    emptyState: document.getElementById('empty-state'),
    currentPath: document.getElementById('current-path'),
    status: document.getElementById('status'),
    newFile: document.getElementById('new-file'),
    addMention: document.getElementById('add-mention'),
    showMentions: document.getElementById('show-mentions'),
    mentionCount: document.getElementById('mention-count'),
    panel: document.getElementById('mentions-panel'),
    panelList: document.getElementById('mentions-list'),
    closeMentions: document.getElementById('close-mentions'),
};

/**
 * Marks a change the editor made to itself — a reload from disk, a resolved
 * mention — as opposed to something typed. Without it the update listener sees
 * "the document changed", flags the buffer dirty and saves it straight back:
 * every external edit came home as a write, which is exactly the echo an agent
 * rewriting files does not need.
 */
const fromDisk = Annotation.define();

const state = {
    tree: [],
    rootIndex: null,
    current: null,
    dirty: false,
    saveTimer: null,
    // The mtime the open document had when it was read. Sent back on save, so
    // a file rewritten under us is refused instead of flattened.
    mtime: 0,
};

let view = null;

function setStatus(message, tone = '') {
    dom.status.textContent = message;
    dom.status.className = `status ${tone}`;
}

function paintTree() {
    renderTree(dom.tree, state.tree, { current: state.current, onOpen: openFile, onToggle: onToggleAndRerender });
}

function onToggleAndRerender(path) {
    toggleDir(path);
    paintTree();
}

async function refreshTree() {
    const { tree, index } = await api.tree();
    state.tree = tree;
    state.rootIndex = index ?? null;

    // Same rule as a folder's index.md, for the root: its name opens its page.
    const rootName = document.querySelector('.root-name');
    if (state.rootIndex) {
        rootName.classList.add('clickable');
        rootName.onclick = () => openFile(state.rootIndex);
    } else {
        rootName.classList.remove('clickable');
        rootName.onclick = null;
    }

    paintTree();
}

async function refreshMentions() {
    const { mentions } = await api.mentions();
    dom.mentionCount.textContent = String(mentions.length);
    dom.showMentions.classList.toggle('has-mentions', mentions.length > 0);
    dom.panelList.textContent = '';

    if (!mentions.length) {
        const empty = document.createElement('p');
        empty.className = 'hint';
        empty.textContent = 'No mention yet. Select a passage and press ⌘M.';
        dom.panelList.appendChild(empty);
        return;
    }

    for (const mention of mentions) {
        const card = document.createElement('article');
        card.className = 'mention-card';

        const prompt = document.createElement('p');
        prompt.className = 'mention-prompt';
        prompt.textContent = mention.prompt || '(no instruction)';

        const where = document.createElement('button');
        where.className = 'link-button mention-where';
        where.textContent = `${mention.file}:${mention.line}`;
        where.onclick = () => openFile(mention.file);

        const quote = document.createElement('p');
        quote.className = 'mention-quote';
        quote.textContent = mention.text.length > 220 ? `${mention.text.slice(0, 220)}…` : mention.text;

        card.append(prompt, where, quote);
        if (mention.unterminated) {
            const warn = document.createElement('p');
            warn.className = 'mention-warn';
            warn.textContent = 'Opening marker with no closing one — it annotates nothing.';
            card.appendChild(warn);
        }
        dom.panelList.appendChild(card);
    }
}

function scheduleSave() {
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(save, 900);
}

async function save() {
    if (!state.current || !view) return;
    clearTimeout(state.saveTimer);
    const source = view.state.doc.toString();
    try {
        const { mtime } = await api.save(state.current, source, state.mtime);
        state.mtime = mtime;
        state.dirty = false;
        setStatus('Saved', 'ok');
        setTimeout(() => state.dirty || setStatus(''), 1200);
        refreshMentions();
    } catch (error) {
        if (error instanceof RequestError && error.payload?.conflict) {
            await resolveConflict(error.payload);
            return;
        }
        setStatus(error.message, 'error');
    }
}

/**
 * The file changed on disk while this tab held unsaved edits — an agent
 * applying mentions, a git pull, another tab. Neither side may be thrown away
 * silently, so it is a question, and the answer decides which one survives.
 */
async function resolveConflict(payload) {
    setStatus('Changed on disk', 'error');
    const keepMine = await askChoice({
        title: 'This file changed on disk',
        body:
            'Something else rewrote it while you had unsaved edits here — an agent applying mentions, ' +
            'a git pull, another tab. Keep your version, or take the one on disk?',
        confirm: 'Keep my version',
        cancel: 'Take the disk version',
    });

    if (keepMine === null) return; // dismissed: nothing decided, nothing lost

    if (keepMine) {
        // Adopting their mtime is what makes the next save go through.
        state.mtime = payload.mtime;
        state.dirty = true;
        await save();
        return;
    }

    view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: payload.source },
        annotations: fromDisk.of(true),
    });
    state.mtime = payload.mtime;
    state.dirty = false;
    setStatus('Reloaded from disk', 'ok');
    refreshMentions();
}

function mountEditor(source) {
    view?.destroy();
    view = new EditorView({
        parent: dom.editor,
        state: EditorState.create({
            doc: source,
            selection: { anchor: source.length },
            extensions: [
                // Image paths are relative to THIS document, not to the page URL.
                docPath.of(state.current ?? ''),
                history(),
                drawSelection(),
                highlightActiveLine(),
                placeholder('Write markdown…'),
                EditorView.lineWrapping,
                markdown({ base: markdownLanguage, codeLanguages }),
                codeHighlighting,
                editorTheme,
                tables,
                tableTheme,
                frontmatter,
                frontmatterTheme,
                livePreview,
                livePreviewTheme,
                mentionsView(resolveMention),
                mentionsTheme,
                keymap.of([
                    { key: 'Mod-s', preventDefault: true, run: () => (save(), true) },
                    { key: 'Mod-m', preventDefault: true, run: () => (addMention(), true) },
                    indentWithTab,
                    ...defaultKeymap,
                    ...historyKeymap,
                ]),
                EditorView.updateListener.of(update => {
                    if (update.docChanged && !update.transactions.some(tr => tr.annotation(fromDisk))) {
                        state.dirty = true;
                        setStatus('Editing…');
                        scheduleSave();
                    }
                    if (update.selectionSet || update.docChanged) {
                        dom.addMention.disabled = update.state.selection.main.empty;
                    }
                }),
            ],
        }),
    });
    dom.addMention.disabled = true;
}

async function openFile(path) {
    if (state.dirty) await save();
    try {
        const { source, mtime } = await api.read(path);
        state.current = path;
        state.mtime = mtime;
        state.dirty = false;
        dom.currentPath.textContent = path;
        dom.emptyState.hidden = true;
        dom.editor.hidden = false;
        mountEditor(source);
        revealFile(path);
        setStatus('');
        paintTree();
        view.focus();
    } catch (error) {
        setStatus(error.message, 'error');
    }
}

/** Wrap the selection in a mention, asking for the instruction first. */
async function addMention() {
    if (!view || !state.current) return;
    const { from, to } = view.state.selection.main;
    if (from === to) {
        setStatus('Select the passage first, then ⌘M.', 'error');
        return;
    }
    const prompt = await askText({
        title: 'Mention for an agent',
        label: 'What should be done with the selected passage?',
        placeholder: 'Reformule ça',
        confirm: 'Leave the mention',
        suggestions: ['Reformule ça', 'Résume cette partie', 'Développe ce point', 'Vérifie les faits'],
    });
    if (!prompt) return;

    const source = view.state.doc.toString();
    const { source: next } = insertMention(source, from, to, prompt);
    view.dispatch({ changes: { from: 0, to: source.length, insert: next } });
    save();
}

/** Clicking a pill: the markers go, the text stays. */
async function resolveMention(id) {
    if (!state.current) return;
    if (state.dirty) await save();
    try {
        const { source } = await api.resolveMention(state.current, id);
        view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: source },
            annotations: fromDisk.of(true),
        });
        const fresh = await api.read(state.current);
        state.mtime = fresh.mtime;
        state.dirty = false;
        setStatus('Mention resolved', 'ok');
        refreshMentions();
    } catch (error) {
        setStatus(error.message, 'error');
    }
}

async function createFile() {
    const suggestion = state.current ? `${state.current.split('/').slice(0, -1).concat('new-note.md').join('/')}` : 'new-note.md';
    const answer = await askText({
        title: 'New markdown file',
        label: 'Path, relative to the served directory',
        value: suggestion,
        confirm: 'Create',
    });
    if (!answer) return;
    const path = answer.replace(/^\/+/, '');
    if (!path) return;
    const target = path.toLowerCase().endsWith('.md') ? path : `${path}.md`;
    const title = target.split('/').pop().replace(/\.md$/i, '');

    try {
        const created = await api.create(target, `# ${title}\n\n`);
        state.mtime = created.mtime;
        await refreshTree();
        await openFile(target);
        setStatus('Created', 'ok');
    } catch (error) {
        setStatus(error.message, 'error');
    }
}

// --- a sidebar you can widen -------------------------------------------------
// Document titles are what the tree shows now, and a real title ("Liste des
// demandes de réservation") does not fit a fixed 280px. The width is the
// reader's call, and it is remembered per browser.
(function resizableSidebar() {
    const sidebar = document.getElementById('sidebar');
    const handle = document.createElement('div');
    handle.className = 'sidebar-handle';
    handle.title = 'Drag to resize — double-click to reset';
    sidebar.appendChild(handle);

    const MIN = 200;
    const MAX = 560;
    const apply = width => {
        const clamped = Math.min(MAX, Math.max(MIN, width));
        sidebar.style.flex = `0 0 ${clamped}px`;
        sidebar.style.width = `${clamped}px`;
        return clamped;
    };

    try {
        const saved = Number(localStorage.getItem('md-browser-editor.sidebar'));
        if (saved) apply(saved);
    } catch {
        /* private window, or storage disabled: the default width is fine */
    }

    handle.addEventListener('mousedown', event => {
        event.preventDefault();
        document.body.classList.add('resizing');
        const move = moveEvent => apply(moveEvent.clientX);
        const up = upEvent => {
            document.body.classList.remove('resizing');
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
            try {
                localStorage.setItem('md-browser-editor.sidebar', String(apply(upEvent.clientX)));
            } catch {
                /* nothing to remember it with */
            }
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
    });

    handle.addEventListener('dblclick', () => {
        apply(280);
        try {
            localStorage.removeItem('md-browser-editor.sidebar');
        } catch {
            /* ditto */
        }
    });
})();

// --- what the agent does, seen from here -------------------------------------
// The server streams one event per burst of filesystem activity. A document
// nobody is editing here reloads itself; one with unsaved edits says so and
// leaves the choice to the save, which will be refused with both versions.
(function liveReload() {
    if (typeof EventSource === 'undefined') return;
    const events = new EventSource('/api/events');

    events.onmessage = async message => {
        let paths = [];
        try {
            paths = JSON.parse(message.data).paths ?? [];
        } catch {
            return;
        }

        // An empty list means "something moved, I cannot say what".
        const touchesOpen = state.current && (paths.length === 0 || paths.includes(state.current));

        refreshTree();
        refreshMentions();

        if (!touchesOpen || !view) return;
        if (state.dirty) {
            setStatus('Changed on disk — your version is still here', 'error');
            return;
        }

        const { source, mtime } = await api.read(state.current).catch(() => ({}));
        if (source === undefined || source === view.state.doc.toString()) {
            if (mtime) state.mtime = mtime;
            return;
        }

        // Keep the caret where it was rather than jumping to the top.
        const caret = Math.min(view.state.selection.main.head, source.length);
        view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: source },
            selection: { anchor: caret },
            annotations: fromDisk.of(true),
        });
        state.mtime = mtime;
        state.dirty = false;
        setStatus('Reloaded', 'ok');
        setTimeout(() => state.dirty || setStatus(''), 1500);
    };
})();

dom.newFile.onclick = createFile;
dom.addMention.onclick = addMention;
function togglePanel(open) {
    dom.panel.hidden = !open;
    // The panel takes its width from the editor rather than covering it:
    // reading a mention's quote while its passage is hidden underneath is
    // exactly the moment you need to see both.
    document.body.classList.toggle('panel-open', open);
    if (open) refreshMentions();
}

dom.showMentions.onclick = () => togglePanel(dom.panel.hidden);
dom.closeMentions.onclick = () => togglePanel(false);

// ⌘S and ⌘M work even when focus is outside the editor.
window.addEventListener('keydown', event => {
    if (!(event.metaKey || event.ctrlKey)) return;
    if (event.key === 's') {
        event.preventDefault();
        save();
    }
    if (event.key === 'm') {
        event.preventDefault();
        addMention();
    }
});

// A pending edit must not be lost to a closed tab.
window.addEventListener('beforeunload', event => {
    if (!state.dirty) return;
    save();
    event.preventDefault();
    event.returnValue = '';
});

await refreshTree();
await refreshMentions();

// Open something on arrival rather than showing an empty frame — the root's
// index page if there is one, since that is the tree's landing page.
const first =
    state.rootIndex ??
    (function firstFile(nodes) {
        for (const node of nodes) {
            if (node.type === 'file') return node.path;
            if (node.index) return node.index;
            const found = firstFile(node.children ?? []);
            if (found) return found;
        }
        return null;
    })(state.tree);
if (first) openFile(first);
