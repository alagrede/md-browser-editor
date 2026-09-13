// The browser's side of the API. Every call reports its failure by throwing a
// message meant to be shown as-is in the toolbar's status slot.

export class RequestError extends Error {
    constructor(message, payload, status) {
        super(message);
        this.payload = payload;
        this.status = status;
    }
}

async function request(url, init) {
    const response = await fetch(url, init);
    const type = response.headers.get('content-type') ?? '';
    const payload = type.includes('json') ? await response.json() : { error: await response.text() };
    if (!response.ok) {
        throw new RequestError(payload.error || `Request failed (${response.status}).`, payload, response.status);
    }
    return payload;
}

export const api = {
    tree: () => request('/api/tree'),
    mentions: () => request('/api/mentions'),
    read: path => request(`/api/file?path=${encodeURIComponent(path)}`),
    // `mtime` is what the editor read. The server refuses the write if the file
    // moved since — see the conflict handling in main.js.
    save: (path, source, mtime) =>
        request(
            `/api/file?path=${encodeURIComponent(path)}${mtime ? `&mtime=${encodeURIComponent(mtime)}` : ''}`,
            {
                method: 'PUT',
                headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
                body: source,
            }
        ),
    create: (path, source) =>
        request(`/api/file?path=${encodeURIComponent(path)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
            body: source,
        }),
    resolveMention: (path, id) =>
        request(`/api/mention?path=${encodeURIComponent(path)}&id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
