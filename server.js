import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { normalizeReport } from './public/data.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const cacheFile = root + '.data/usage.json';
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const run = promisify(execFile);
let snapshot;
let pending;

async function refresh() {
  if (pending) return pending;
  pending = (async () => {
    const { stdout } = await run(process.execPath, [root + 'node_modules/ccusage/src/cli.js', 'daily', '--json', '--by-agent', '--offline', '--timezone', timezone], {
      cwd: root, timeout: 90000, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, NO_COLOR: '1' },
    });
    const report = normalizeReport(JSON.parse(stdout));
    const next = { ...report, updatedAt: new Date().toISOString(), timezone, pricing: 'offline' };
    await mkdir(root + '.data', { recursive: true });
    await writeFile(cacheFile + '.tmp', JSON.stringify(next), { mode: 0o600 });
    await rename(cacheFile + '.tmp', cacheFile);
    snapshot = next;
    return snapshot;
  })().finally(() => { pending = undefined; });
  return pending;
}

const assets = new Map([
  ['/', ['index.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']],
  ['/data.js', ['data.js', 'text/javascript']], ['/style.css', ['style.css', 'text/css']],
]);

export async function handleRequest(request, { port, getSnapshot, reload }) {
  const url = new URL(request.url);
  const allowed = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const origin = request.headers.get('origin');
  if (!allowed.has(url.host) || !allowed.has(request.headers.get('host') ?? url.host)
      || (origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(origin))
      || request.headers.get('sec-fetch-site') === 'cross-site') return new Response('Forbidden', { status: 403 });
  const headers = {
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  };
  if (url.pathname === '/api/usage') {
    if (!['GET', 'POST'].includes(request.method)) return new Response('Method not allowed', { status: 405, headers });
    try {
      const data = request.method === 'POST' ? await reload() : await getSnapshot();
      return Response.json(data, { headers });
    } catch (error) {
      console.error('ccusage refresh failed:', error.message);
      return Response.json({ error: 'Could not read ccusage. Run bun install --frozen-lockfile, then bun run ccusage daily --json --by-agent --offline in your terminal to diagnose it. The last successful snapshot is kept.' }, { status: 503, headers });
    }
  }
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers });
  const asset = assets.get(url.pathname);
  if (!asset) return new Response('Not found', { status: 404, headers });
  return new Response(Bun.file(root + 'public/' + asset[0]), { headers: { ...headers, 'Content-Type': asset[1] + '; charset=utf-8' } });
}

if (import.meta.main) {
  try { snapshot = JSON.parse(await readFile(cacheFile, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') console.warn('Saved snapshot could not be read; refresh will rebuild it.'); }
  const port = Number(process.env.PORT || 4318);
  const server = Bun.serve({ hostname: '127.0.0.1', port, idleTimeout: 120,
    fetch: request => handleRequest(request, { port: server.port, getSnapshot: () => snapshot ?? refresh(), reload: refresh }),
  });
  console.log(`Agent Almanac → ${server.url}  (${timezone})`);
}
