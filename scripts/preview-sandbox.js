import { buildSandbox, output, sandboxFiles, sandboxCsp } from './build-sandbox.js';

await buildSandbox();
const server = Bun.serve({
  hostname: '127.0.0.1', port: Number(process.env.PORT || 4319),
  fetch(request) {
    // The project subpath mirrors GitHub Pages, catching root-relative asset mistakes.
    const path = new URL(request.url).pathname.replace(/^\/agent-almanac\//, '/');
    const file = path === '/' ? 'index.html' : path.slice(1);
    if (request.method !== 'GET' || !sandboxFiles.includes(file)) return new Response('Not found', { status: 404 });
    return new Response(Bun.file(output + file), { headers: { 'Cache-Control': 'no-store', 'Content-Security-Policy': sandboxCsp, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } });
  },
});
console.log(`Sandbox → ${server.url}agent-almanac/`);
