// Mentions, in the editor: the markers fold away and the passage they wrap is
// highlighted, with the instruction shown as a pill you can click to resolve.
//
// The parsing lives in src/mentions.mjs — the same module the CLI and the API
// use, so what the editor shows and what an agent reads can never diverge.
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import { RangeSet } from '@codemirror/state';
import { parseMentions } from '../src/mentions.mjs';

class PromptWidget extends WidgetType {
    constructor(id, prompt) {
        super();
        this.id = id;
        this.prompt = prompt;
    }

    eq(other) {
        return other.id === this.id && other.prompt === this.prompt;
    }

    toDOM() {
        const pill = document.createElement('span');
        pill.className = 'cm-mention-pill';
        pill.dataset.mentionId = this.id;
        pill.title = 'Click to resolve this mention (keeps the text, drops the markers)';
        pill.textContent = `＠ ${this.prompt}`;
        return pill;
    }

    ignoreEvent() {
        return false;
    }
}

function buildDecorations(view) {
    const source = view.state.doc.toString();
    if (!source.includes('<!--ai:')) return RangeSet.empty;

    const items = [];
    for (const mention of parseMentions(source)) {
        // The opening marker becomes the pill; the closing one disappears.
        items.push({
            from: mention.from,
            to: mention.bodyFrom,
            deco: Decoration.replace({ widget: new PromptWidget(mention.id, mention.prompt) }),
        });
        if (mention.unterminated) continue;
        if (mention.bodyTo > mention.bodyFrom) {
            items.push({
                from: mention.bodyFrom,
                to: mention.bodyTo,
                deco: Decoration.mark({ class: 'cm-mention-body', attributes: { 'data-mention-id': mention.id } }),
            });
        }
        items.push({ from: mention.bodyTo, to: mention.to, deco: Decoration.replace({}) });
    }

    items.sort((a, b) => a.from - b.from || a.to - b.to);
    return RangeSet.of(
        items.map(item => item.deco.range(item.from, item.to)),
        true
    );
}

/**
 * @param {(id: string) => void} onResolve called when a pill is clicked
 */
export function mentionsView(onResolve) {
    return ViewPlugin.fromClass(
        class {
            constructor(view) {
                this.decorations = buildDecorations(view);
            }

            update(update) {
                if (update.docChanged || update.viewportChanged) {
                    this.decorations = buildDecorations(update.view);
                }
            }
        },
        {
            decorations: plugin => plugin.decorations,
            eventHandlers: {
                mousedown(event) {
                    const pill = event.target.closest?.('.cm-mention-pill');
                    if (!pill) return false;
                    event.preventDefault();
                    onResolve(pill.dataset.mentionId);
                    return true;
                },
            },
        }
    );
}

export const mentionsTheme = EditorView.theme({
    '.cm-mention-pill': {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.3em',
        background: 'var(--mention-bg)',
        color: 'var(--mention-fg)',
        border: '1px solid var(--mention-border)',
        borderRadius: '999px',
        padding: '0.05em 0.6em',
        fontSize: '0.78em',
        fontFamily: 'var(--sans)',
        fontWeight: '600',
        cursor: 'pointer',
        marginRight: '0.35em',
        verticalAlign: 'baseline',
        whiteSpace: 'nowrap',
    },
    '.cm-mention-pill:hover': { filter: 'brightness(1.08)' },
    '.cm-mention-body': {
        background: 'var(--mention-highlight)',
        borderBottom: '1px solid var(--mention-border)',
        borderRadius: '2px',
    },
});
