import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const output = root + 'dist/sandbox/';
export const sandboxFiles = [
  'index.html', 'style.css', 'agent-almanac-logo.svg',
  'favicon.svg', 'favicon.ico', 'favicon-96x96.png', 'apple-touch-icon.png', 'site.webmanifest', 'web-app-manifest-192x192.png', 'web-app-manifest-512x512.png',
  'app.js', 'data.js', 'story.js', 'import.js', 'examples.js', 'sandbox.js', 'LICENSE', '.nojekyll',
];
export const sandboxCsp = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; manifest-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'";

export async function buildSandbox() {
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  const html = (await readFile(root + 'public/index.html', 'utf8'))
    .replace('<meta charset="UTF-8">', `<meta charset="UTF-8">\n  <meta http-equiv="Content-Security-Policy" content="${sandboxCsp}">\n  <meta name="referrer" content="no-referrer">`)
    .replace('<body>', '<body data-mode="sandbox">')
    .replace('<title>Agent Almanac · Your usage, in perspective</title>', '<title>Agent Almanac Sandbox · Try your usage report</title>');
  await writeFile(output + 'index.html', html);
  for (const file of sandboxFiles.filter(name => !['index.html', 'LICENSE', '.nojekyll'].includes(name))) {
    await copyFile(root + 'public/' + file, output + file);
  }
  await copyFile(root + 'LICENSE', output + 'LICENSE');
  await writeFile(output + '.nojekyll', '');
  console.log('Built dist/sandbox using only public assets and synthetic examples.');
}

if (import.meta.main) await buildSandbox();
