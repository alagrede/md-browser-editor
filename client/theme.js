// The editor's own chrome. It lives here rather than in app.css because
// CodeMirror injects a base theme whose `.cm-content { font-family: monospace }`
// beats a plain stylesheet — a prose editor that renders everything in
// monospace is the visible symptom.
import { EditorView } from '@codemirror/view';

export const editorTheme = EditorView.theme({
    '&': {
        height: '100%',
        color: 'var(--text)',
        backgroundColor: 'var(--bg)',
        fontFamily: 'var(--sans)',
        fontSize: '16px',
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
        fontFamily: 'inherit',
        lineHeight: '1.7',
        // A comfortable measure, centred, without a wrapper element.
        padding: '32px max(24px, calc(50% - 23rem))',
    },
    '.cm-content': { fontFamily: 'inherit', caretColor: 'var(--accent)', paddingBottom: '40vh' },
    '.cm-line': { padding: '0' },
    // The band across the caret's line fights with rendered prose; the caret
    // itself says where you are.
    '.cm-activeLine': { backgroundColor: 'transparent' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
        backgroundColor: 'var(--selection)',
    },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
    '.cm-placeholder': { color: 'var(--text-dim)' },
});
