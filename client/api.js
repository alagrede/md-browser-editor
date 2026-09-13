// The browser's side of the API. Every call reports its failure by throwing a
// message meant to be shown as-is in the toolbar's status slot.

async function request(url, init) {
    const response = await fetch(url, init);
    const type = response.headers.get('content-type') ?? '';
    const payload = type.includes('json') ? await response.json() : { error: await response.text() };
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
    return payload;
}

export const api = {
    tree: () => request('/api/tree'),
    mentions: () => request('/api/mentions'),
    read: path => request(`/api/file?path=${encodeURIComponent(path)}`),
    save: (path, source) =>
        request(`/api/file?path=${encodeURIComponent(path)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
            body: source,
        }),
    create: (path, source) =>
        request(`/api/file?path=${encodeURIComponent(path)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
            body: source,
        }),
    resolveMention: (path, id) =>
        request(`/api/mention?path=${encodeURIComponent(path)}&id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
