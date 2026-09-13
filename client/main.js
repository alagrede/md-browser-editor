// Wiring: the explorer, the editor, and the two actions that write —
// creating a file and leaving a mention.
//
// Saving is debounced and also bound to ⌘S. The editor never holds a document
// the server has not confirmed: a failed save leaves the buffer dirty and says
// so, rather than pretending.
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, highlightActiveLine, drawSelection, placeholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
// markdownLanguage, not the default base: the default is plain CommonMark,
// which has no tables and no strikethrough — their nodes never appear in the
// tree, so the decorations for them silently never fire.
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { codeLanguages } from './code-languages.js';
import { codeHighlighting } from './highlight.js';
import { tables, tableTheme } from './table.js';
import { api } from './api.js';
import { livePreview, livePreviewTheme } from './live-preview.js';
import { editorTheme } from './theme.js';
import { mentionsTheme, mentionsView } from './mentions-view.js';
import { renderTree, revealFile, toggleDir } from './tree.js';
import { insertMention } from '../src/mentions.mjs';
import { askText } from './ask.js';

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

const state = {
    tree: [],
    current: null,
    dirty: false,
    saveTimer: null,
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
    const { tree } = await api.tree();
    state.tree = tree;
    paintTree();
}

async function refreshMentions() {
    const { mentions } = await api.mentions();
    dom.mentionCount.textContent = String(mentions.length);
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
        await api.save(state.current, source);
        state.dirty = false;
        setStatus('Saved', 'ok');
        setTimeout(() => state.dirty || setStatus(''), 1200);
        refreshMentions();
    } catch (error) {
        setStatus(error.message, 'error');
    }
}

function mountEditor(source) {
    view?.destroy();
    view = new EditorView({
        parent: dom.editor,
        state: EditorState.create({
            doc: source,
            selection: { anchor: source.length },
            extensions: [
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
                    if (update.docChanged) {
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
        const { source } = await api.read(path);
        state.current = path;
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
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: source } });
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
        await api.create(target, `# ${title}\n\n`);
        await refreshTree();
        await openFile(target);
        setStatus('Created', 'ok');
    } catch (error) {
        setStatus(error.message, 'error');
    }
}

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

// Open the first file so the editor is never an empty frame on arrival.
const first = (function firstFile(nodes) {
    for (const node of nodes) {
        if (node.type === 'file') return node.path;
        const found = firstFile(node.children ?? []);
        if (found) return found;
    }
    return null;
})(state.tree);
if (first) openFile(first);
