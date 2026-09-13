// Builds client/main.js (and everything it imports, CodeMirror included) into
// the single public/app.js the server serves.
//
// The bundle is COMMITTED: `npx md-browser-editor serve` must work with no
// install step and no network, and the runtime dependency count stays at zero.
// Rebuild with `npm run build` after touching anything under client/.
import { build } from 'esbuild';

const result = await build({
    entryPoints: ['client/main.js'],
    outfile: 'public/app.js',
    bundle: true,
    format: 'esm',
    target: ['es2022'],
    minify: true,
    sourcemap: false,
    legalComments: 'none',
    logLevel: 'info',
    metafile: true,
});

const bytes = Object.values(result.metafile.outputs)[0]?.bytes ?? 0;
console.log(`public/app.js — ${(bytes / 1024).toFixed(0)} kB`);
