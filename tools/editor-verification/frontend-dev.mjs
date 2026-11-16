import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const requestedCache = path.resolve(process.argv[2]);
if (!requestedCache.startsWith(`${path.join(repository, 'work')}${path.sep}`)) throw new Error('Independent run identifier must remain below work.');
const { createServer } = await import(pathToFileURL(path.join(repository, 'tools/editor-web/node_modules/vite/dist/node/index.js')).href);
const frontend = path.join(repository, 'tools/editor-web');
// Keep generated dependencies inside the real project's precise allowlist,
// with a unique ignored cache; never widen server.fs.allow in the harness.
const cache = path.join(frontend, 'node_modules/.vite-p1-independent', path.basename(path.dirname(requestedCache)));
process.stdout.write(`Independent generated Vite cache: ${cache}\n`);
const server = await createServer({ root: frontend, configFile: path.join(frontend, 'vite.config.ts'), cacheDir: cache, server: { host: '127.0.0.1', port: 5176, strictPort: true, proxy: { '/api': { target: 'http://127.0.0.1:5186', changeOrigin: false } } } });
await server.listen(); server.printUrls();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void server.close().finally(() => process.exit(0)); });
