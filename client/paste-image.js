// Pasting an image: the file goes into the document's assets folder, and an
// image reference goes where the caret is.
import { EditorView } from '@codemirror/view';

const ACCEPTED = /^image\/(png|jpeg|gif|webp)$/;

/**
 * The images a paste carries, or none when it should stay a text paste.
 *
 * A clipboard often holds both. Cells copied from a spreadsheet come with a
 * picture of themselves, a paragraph from a word processor likewise — the
 * text is what was meant there. An image copied from a browser or a
 * screenshot carries no plain text, so text wins whenever there is some.
 */
export function imagesToUpload(clipboard) {
    if (!clipboard) return [];
    if (clipboard.getData('text/plain').trim()) return [];
    return [...clipboard.files].filter(file => ACCEPTED.test(file.type));
}

/** `![](reference)`, one per image, each on its own line when there are several. */
export const imageMarkdown = references => references.map(reference => `![](${reference})`).join('\n');

/**
 * @param {{document: () => string|null, upload: (document: string, file: File) => Promise<{reference: string}>,
 *   onStatus: (message: string, tone?: string) => void}} options
 */
export function pasteImages({ document, upload, onStatus }) {
    return EditorView.domEventHandlers({
        paste(event, view) {
            const files = imagesToUpload(event.clipboardData);
            const current = document();
            if (!files.length || !current) return false;
            event.preventDefault();

            onStatus(files.length > 1 ? `Saving ${files.length} images…` : 'Saving image…');
            Promise.all(files.map(file => upload(current, file)))
                .then(saved => {
                    // Another document may be open by now; its caret is not
                    // where this image was pasted. The file is written either way.
                    if (document() !== current || view.dom.isConnected === false) return;
                    const insert = imageMarkdown(saved.map(entry => entry.reference));
                    const { from, to } = view.state.selection.main;
                    view.dispatch({
                        changes: { from, to, insert },
                        selection: { anchor: from + insert.length },
                        scrollIntoView: true,
                        userEvent: 'input.paste',
                    });
                    view.focus();
                })
                .catch(error => onStatus(error.message, 'error'));
            return true;
        },
    });
}
