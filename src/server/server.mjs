// The HTTP server: a small JSON API over one directory of markdown, plus the
// static shell that loads the editor.
//
// Nothing is generated on disk and nothing is cached: files are read on every
// request, so what the browser shows is what is on disk. Writes are confined
// to .md files under the root (see markdownTarget) — the editor edits
// documents, nothing else.
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectMentions } from '../collect.mjs';
import { removeMention } from '../mentions.mjs';
import { hrefFor, markdownTarget, mimeFor, resolveInRoot } from '../paths.mjs';
import { buildTree, rootIndex } from '../tree.mjs';
import { renderShell } from './shell.mjs';

const PUBLIC_DIR = fileURLToPath(new URL('../../public/', import.meta.url));

/** Everything the browser is allowed to load from the package itself. */
const ASSETS = {
    '/app.js': 'text/javascript; charset=utf-8',
    '/app.css': 'text/css; charset=utf-8',
};

function json(response, status, payload) {
    const body = JSON.stringify(payload);
    response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
    });
    response.end(body);
}

function text(response, status, body) {
    response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(body);
}

/** Request body as a string, with a ceiling so a stuck client cannot grow it forever. */
function readBody(request, limit = 8 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        request.on('data', chunk => {
            size += chunk.length;
            if (size > limit) {
                reject(new Error('Request body too large.'));
                request.destroy();
                return;
            }
            chunks.push(chunk);
        });
        request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        request.on('error', reject);
    });
}

/**
 * @param {{root: string, host?: string, port?: number, title?: string}} options
 * @returns {Promise<{url: string, port: number, close: () => Promise<void>}>}
 */
export async function startServer({ root, host = '127.0.0.1', port = 4830, title }) {
    const documentTitle = title ?? path.basename(root);

    async function handle(request, response) {
        const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);
        const route = url.pathname;

        // --- the shell -----------------------------------------------------
        if (route === '/' && request.method === 'GET') {
            response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
            response.end(renderShell({ title: documentTitle, root }));
            return;
        }

        if (ASSETS[route] && request.method === 'GET') {
            const file = path.join(PUBLIC_DIR, route.slice(1));
            if (!existsSync(file)) {
                text(response, 500, `Missing build artifact: public${route}. Run \`npm run build\`.`);
                return;
            }
            response.writeHead(200, { 'Content-Type': ASSETS[route], 'Cache-Control': 'no-store' });
            response.end(await readFile(file));
            return;
        }

        // --- the API -------------------------------------------------------
        if (route === '/api/tree' && request.method === 'GET') {
            json(response, 200, {
                root: path.basename(root),
                index: await rootIndex(root),
                tree: await buildTree(root),
            });
            return;
        }

        if (route === '/api/mentions' && request.method === 'GET') {
            json(response, 200, { mentions: await collectMentions(root) });
            return;
        }

        if (route === '/api/file') {
            const requested = url.searchParams.get('path') ?? '';

            if (request.method === 'GET') {
                const target = markdownTarget(root, requested);
                if (!target) return void json(response, 403, { error: 'Refused: not a markdown file under the root.' });
                if (!existsSync(target)) return void json(response, 404, { error: 'No such file.' });
                const source = await readFile(target, 'utf8');
                const info = await stat(target);
                json(response, 200, { path: requested, source, mtime: info.mtimeMs });
                return;
            }

            if (request.method === 'PUT' || request.method === 'POST') {
                const target = markdownTarget(root, requested);
                if (!target) return void json(response, 403, { error: 'Refused: not a markdown file under the root.' });

                const creating = request.method === 'POST';
                if (creating && existsSync(target)) {
                    return void json(response, 409, { error: 'That file already exists.' });
                }
                if (!creating && !existsSync(target)) {
                    return void json(response, 404, { error: 'No such file — create it first.' });
                }

                const body = await readBody(request);
                // Exactly one trailing newline, whatever the editor sent: these
                // files live in git, and a missing one shows up as a "\ No
                // newline at end of file" in every diff that touches the last line.
                const normalized = `${body.replace(/\s*$/, '')}\n`;
                if (creating) await mkdir(path.dirname(target), { recursive: true });
                await writeFile(target, normalized, 'utf8');
                const info = await stat(target);
                json(response, creating ? 201 : 200, { path: requested, mtime: info.mtimeMs });
                return;
            }

            json(response, 405, { error: 'Method not allowed.' });
            return;
        }

        // Resolving a mention from the editor: the markers go, the text stays.
        if (route === '/api/mention' && request.method === 'DELETE') {
            const target = markdownTarget(root, url.searchParams.get('path') ?? '');
            const id = url.searchParams.get('id') ?? '';
            if (!target) return void json(response, 403, { error: 'Refused: not a markdown file under the root.' });
            if (!existsSync(target)) return void json(response, 404, { error: 'No such file.' });
            const source = await readFile(target, 'utf8');
            const next = removeMention(source, id);
            if (next !== source) await writeFile(target, next, 'utf8');
            json(response, 200, { path: url.searchParams.get('path'), source: next });
            return;
        }

        // --- assets referenced by the documents -----------------------------
        if (request.method === 'GET') {
            const target = resolveInRoot(root, route);
            if (!target || !existsSync(target)) {
                text(response, 404, 'Not found.');
                return;
            }
            const mime = mimeFor(target);
            // Refused rather than octet-streamed: see the allowlist's comment.
            if (!mime) {
                text(response, 404, 'Not a servable file type.');
                return;
            }
            response.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
            response.end(await readFile(target));
            return;
        }

        text(response, 405, 'Method not allowed.');
    }

    const server = createServer((request, response) => {
        handle(request, response).catch(error => {
            if (response.headersSent) return;
            text(response, 500, `Server error: ${error.message}`);
        });
    });

    /** Takes the first free port at or above the requested one. */
    const port_ = await new Promise((resolve, reject) => {
        let attemptsLeft = 10;
        let current = port;
        const onError = error => {
            if (error.code === 'EADDRINUSE' && attemptsLeft-- > 0) {
                console.log(`Port ${current} is busy, trying ${current + 1}…`);
                current += 1;
                server.listen(current, host);
                return;
            }
            reject(error);
        };
        server.on('error', onError);
        server.listen(current, host, () => {
            server.off('error', onError);
            server.on('error', error => console.error(error.message));
            resolve(current);
        });
    });

    return {
        port: port_,
        url: `http://${host}:${port_}/`,
        href: file => hrefFor(root, file),
        close: () => new Promise(resolve => server.close(resolve)),
    };
}
