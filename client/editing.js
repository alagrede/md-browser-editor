// What the keyboard and the right-click menu can do, in one list so the two
// cannot offer different things — or, worse, name the same thing differently.
import { keymap } from '@codemirror/view';
import {
    clearFormatting,
    insertCodeBlock,
    insertDivider,
    insertLink,
    insertTable,
    setHeading,
    toggleBold,
    toggleBullet,
    toggleCode,
    toggleItalic,
    toggleOrdered,
    toggleQuote,
    toggleStrikethrough,
    toggleTask,
} from './format.js';
import { showContextMenu } from './context-menu.js';

const mac = typeof navigator !== 'undefined' && /Mac|iP(hone|ad)/.test(navigator.platform ?? '');
const mod = mac ? '⌘' : 'Ctrl';

/** [binding, menu label, shortcut as shown] */
const ACTIONS = [
    { key: 'Mod-b', label: 'Bold', shown: `${mod}B`, run: toggleBold, group: 'format' },
    { key: 'Mod-i', label: 'Italic', shown: `${mod}I`, run: toggleItalic, group: 'format' },
    { key: 'Mod-e', label: 'Code', shown: `${mod}E`, run: toggleCode, group: 'format' },
    { key: 'Mod-Shift-x', label: 'Strikethrough', shown: `${mod}⇧X`, run: toggleStrikethrough, group: 'format' },
    { key: 'Mod-k', label: 'Link', shown: `${mod}K`, run: insertLink(false), group: 'format' },
    { label: 'Clear formatting', run: clearFormatting, group: 'format', needsSelection: true },

    { key: 'Mod-1', label: 'Heading 1', shown: `${mod}1`, run: setHeading(1), group: 'block' },
    { key: 'Mod-2', label: 'Heading 2', shown: `${mod}2`, run: setHeading(2), group: 'block' },
    { key: 'Mod-3', label: 'Heading 3', shown: `${mod}3`, run: setHeading(3), group: 'block' },
    { key: 'Mod-Shift-8', label: 'Bullet list', shown: `${mod}⇧8`, run: toggleBullet, group: 'block' },
    { key: 'Mod-Shift-7', label: 'Numbered list', shown: `${mod}⇧7`, run: toggleOrdered, group: 'block' },
    { key: 'Mod-Shift-9', label: 'Task list', shown: `${mod}⇧9`, run: toggleTask, group: 'block' },
    { key: "Mod-Shift-'", label: 'Quote', shown: `${mod}⇧'`, run: toggleQuote, group: 'block' },

    { label: 'Image', run: insertLink(true), group: 'insert' },
    { label: 'Table', run: insertTable, group: 'insert' },
    { label: 'Code block', run: insertCodeBlock, group: 'insert' },
    { label: 'Divider', run: insertDivider, group: 'insert' },
];

/** The keymap, for the actions that have a binding. */
export const editingKeymap = keymap.of(
    ACTIONS.filter(action => action.key).map(action => ({
        key: action.key,
        preventDefault: true,
        run: view => action.run(view) || true,
    }))
);

const item = action => ({
    label: action.label,
    key: action.shown,
    run: action.run,
});

/** Items for the menu, given the current state. */
export function menuItems(view, { onMention }) {
    const hasSelection = !view.state.selection.main.empty;
    const byGroup = group => ACTIONS.filter(action => action.group === group).map(item);

    return [
        {
            // Without a selection the same command asks about the document, so
            // the label has to say which one you are about to leave.
            label: hasSelection ? 'Leave a mention…' : 'Leave a mention on this file…',
            key: `${mod}M`,
            run: onMention,
        },
        '-',
        { heading: 'Format' },
        ...byGroup('format').map(entry =>
            entry.label === 'Clear formatting' ? { ...entry, enabled: hasSelection } : entry
        ),
        '-',
        { heading: 'Turn into' },
        ...byGroup('block'),
        '-',
        { heading: 'Insert' },
        ...byGroup('insert'),
        '-',
        {
            label: 'Cut',
            enabled: hasSelection,
            run: async target => {
                const { from, to } = target.state.selection.main;
                await navigator.clipboard.writeText(target.state.sliceDoc(from, to));
                target.dispatch({ changes: { from, to }, userEvent: 'delete.cut' });
            },
        },
        {
            label: 'Copy',
            enabled: hasSelection,
            run: target => {
                const { from, to } = target.state.selection.main;
                navigator.clipboard.writeText(target.state.sliceDoc(from, to));
            },
        },
    ];
}

export { showContextMenu };
