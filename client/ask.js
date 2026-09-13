// A small modal for the two things the editor has to ask: the path of a new
// file, and the instruction of a mention.
//
// Not window.prompt: it blocks the page, it cannot carry suggestions, and
// several browser hosts refuse to show it at all.

/**
 * @param {{title: string, label: string, value?: string, placeholder?: string,
 *          confirm?: string, suggestions?: string[]}} options
 * @returns {Promise<string|null>} the text, or null when dismissed
 */
export function askText({ title, label, value = '', placeholder = '', confirm = 'OK', suggestions = [] }) {
    return new Promise(resolve => {
        const dialog = document.createElement('dialog');
        dialog.className = 'ask';

        const form = document.createElement('form');
        form.method = 'dialog';

        const heading = document.createElement('h2');
        heading.textContent = title;

        const labelElement = document.createElement('label');
        labelElement.textContent = label;
        labelElement.htmlFor = 'ask-input';

        const input = document.createElement('input');
        input.id = 'ask-input';
        input.type = 'text';
        input.value = value;
        input.placeholder = placeholder;
        input.autocomplete = 'off';

        const chips = document.createElement('div');
        chips.className = 'ask-chips';
        for (const suggestion of suggestions) {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'ask-chip';
            chip.textContent = suggestion;
            chip.onclick = () => {
                input.value = suggestion;
                input.focus();
            };
            chips.appendChild(chip);
        }

        const actions = document.createElement('div');
        actions.className = 'ask-actions';
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'button';
        cancel.textContent = 'Cancel';
        const submit = document.createElement('button');
        submit.type = 'submit';
        submit.className = 'button primary';
        submit.textContent = confirm;
        actions.append(cancel, submit);

        form.append(heading, labelElement, input, ...(suggestions.length ? [chips] : []), actions);
        dialog.appendChild(form);
        document.body.appendChild(dialog);

        let answer = null;
        const close = () => {
            dialog.close();
            dialog.remove();
            resolve(answer);
        };
        cancel.onclick = close;
        dialog.addEventListener('cancel', close); // Escape
        form.addEventListener('submit', event => {
            event.preventDefault();
            answer = input.value.trim() || null;
            close();
        });

        dialog.showModal();
        input.focus();
        input.select();
    });
}

/**
 * A question with two ways out and no text to type. Returns true for the
 * primary choice, false for the other, null when dismissed.
 *
 * @param {{title: string, body: string, confirm: string, cancel: string}} options
 */
export function askChoice({ title, body, confirm, cancel }) {
    return new Promise(resolve => {
        const dialog = document.createElement('dialog');
        dialog.className = 'ask';

        const heading = document.createElement('h2');
        heading.textContent = title;
        const text = document.createElement('p');
        text.className = 'ask-body';
        text.textContent = body;

        const actions = document.createElement('div');
        actions.className = 'ask-actions';
        const no = document.createElement('button');
        no.type = 'button';
        no.className = 'button';
        no.textContent = cancel;
        const yes = document.createElement('button');
        yes.type = 'button';
        yes.className = 'button primary';
        yes.textContent = confirm;
        actions.append(no, yes);

        const wrap = document.createElement('div');
        wrap.className = 'ask-content';
        wrap.append(heading, text, actions);
        dialog.appendChild(wrap);
        document.body.appendChild(dialog);

        const close = answer => {
            dialog.close();
            dialog.remove();
            resolve(answer);
        };
        no.onclick = () => close(false);
        yes.onclick = () => close(true);
        dialog.addEventListener('cancel', () => close(null));

        dialog.showModal();
        yes.focus();
    });
}
