// Pasting a file: it goes into the document's assets folder, and a reference
// to it goes where the caret is — an image shows, anything else is a link.
import { EditorView } from '@codemirror/view';

/**
 * What a paste carries: the files to upload, or none when it should stay a
 * text paste, and the files that were left out.
 *
 * A clipboard often holds both. Cells copied from a spreadsheet come with a
 * picture of themselves, a paragraph from a word processor likewise — the
 * text is what was meant there, so text wins. Except when the text is only
 * the names of the files: that is what a file copied in the Finder or the
 * Explorer puts next to it, and the file is what was meant.
 *
 * Folders are the only thing refused: there is nothing to upload.
 */
export function filesToUpload(clipboard) {
    if (!clipboard) return { accepted: [], refused: [] };
    const files = [...clipboard.files];
    if (!files.length) return { accepted: [], refused: [] };

    const text = clipboard.getData('text/plain');
    const names = new Set(files.map(file => file.name));
    const lines = text.split(/[\r\n]+/).map(line => line.trim()).filter(Boolean);
    if (lines.length && !lines.every(line => names.has(line))) return { accepted: [], refused: [] };

    // A folder copied in the Finder arrives as an empty, typeless "file".
    const isFolder = file => file.size === 0 && !file.type;
    return { accepted: files.filter(file => !isFolder(file)), refused: files.filter(isFolder) };
}

/** Brackets in a link text would end it early. */
const linkText = name => String(name ?? '').replace(/[[\]\\]/g, '\\$&');

/**
 * The markdown for what was saved: an image shows, any other file is a link
 * named after it — one per line when there are several.
 */
export const assetMarkdown = saved =>
    saved
        .map(({ reference, kind, name }) =>
            kind === 'image' ? `![](${reference})` : `[${linkText(name) || reference}](${reference})`
        )
        .join('\n');

/**
 * @param {{document: () => string|null, upload: (document: string, file: File) => Promise<{reference: string, kind: string}>,
 *   onStatus: (message: string, tone?: string) => void}} options
 */
export function pasteAssets({ document, upload, onStatus }) {
    return EditorView.domEventHandlers({
        paste(event, view) {
            const { accepted, refused } = filesToUpload(event.clipboardData);
            const current = document();
            if (!current || (!accepted.length && !refused.length)) return false;
            event.preventDefault();

            if (!accepted.length) {
                // Silence here reads as "paste is broken".
                onStatus('A folder cannot be pasted — paste the files in it.', 'error');
                return true;
            }

            onStatus(accepted.length > 1 ? `Saving ${accepted.length} files…` : 'Saving…');
            Promise.all(accepted.map(file => upload(current, file).then(entry => ({ ...entry, name: file.name }))))
                .then(saved => {
                    // Another document may be open by now; its caret is not
                    // where this was pasted. The files are written either way.
                    if (document() !== current || view.dom.isConnected === false) return;
                    const insert = assetMarkdown(saved);
                    const { from, to } = view.state.selection.main;
                    view.dispatch({
                        changes: { from, to, insert },
                        selection: { anchor: from + insert.length },
                        scrollIntoView: true,
                        userEvent: 'input.paste',
                    });
                    view.focus();
                    if (refused.length) onStatus(`Skipped ${refused.map(file => file.name).join(', ')}: a folder cannot be pasted.`, 'error');
                })
                .catch(error => onStatus(error.message, 'error'));
            return true;
        },
    });
}
