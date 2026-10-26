import { test, expect } from 'bun:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, copyFile, writeFile, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSandbox, root, output, sandboxFiles } from '../scripts/build-sandbox.js';

const faviconFiles = ['favicon.svg', 'favicon.ico', 'favicon-96x96.png', 'apple-touch-icon.png', 'site.webmanifest', 'web-app-manifest-192x192.png', 'web-app-manifest-512x512.png'];

test.each([
  ['server launcher', [root + 'node_modules/ccusage/src/cli.js']],
  ['diagnostic command', ['run', '--bun', 'ccusage']],
  ['sandbox command', ['x', '--no-install', '--bun', 'ccusage']],
])('%s uses Bun for the pinned ccusage launcher', async (_label, args) => {
  const directory = await mkdtemp(join(tmpdir(), 'almanac runtime '));
  try {
    const guard = join(directory, 'reject-node.cjs').replaceAll('\\', '/');
    await writeFile(guard, 'throw new Error("ccusage must run with Bun");');
    const pkg = JSON.parse(await readFile(root + 'package.json', 'utf8'));
    // A Node preload catches accidental shebang dispatch when Node is installed.
    const { stdout } = await promisify(execFile)(process.execPath, [...args, '--version'], {
      cwd: root, env: { ...process.env, NODE_OPTIONS: `--require "${guard}"` }, timeout: 15000,
    });
    expect(stdout.trim()).toBe('ccusage ' + pkg.dependencies.ccusage);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('sandbox build contains only public files and disables API connections', async () => {
  await buildSandbox();
  expect((await readdir(output)).sort()).toEqual(sandboxFiles.slice().sort());
  const html = await readFile(output + 'index.html', 'utf8');
  expect(html).toContain('data-mode="sandbox"');
  expect(html).toContain("connect-src 'none'");
  expect(html).toContain('src="./app.js"');
  expect(html).toContain('href="./style.css"');
  expect(html).toContain('src="./agent-almanac-logo.svg"');
  expect(await readFile(output + 'agent-almanac-logo.svg', 'utf8')).toBe(await readFile(root + 'public/agent-almanac-logo.svg', 'utf8'));
  expect(html).toContain("manifest-src 'self'");
  for (const file of faviconFiles) {
    expect(await readFile(output + file)).toEqual(await readFile(root + 'public/' + file));
    if (!file.startsWith('web-app-manifest-')) expect(html).toContain(`href="./${file}"`);
  }
  const manifest = JSON.parse(await readFile(output + 'site.webmanifest', 'utf8'));
  expect(manifest.name).toBe('Agent Almanac');
  for (const icon of manifest.icons) {
    const url = new URL(icon.src, 'https://example.test/agent-almanac/site.webmanifest');
    expect(url.pathname).toBe('/agent-almanac/' + icon.src.replace(/^\.\//, ''));
    expect((await readFile(output + icon.src)).length).toBeGreaterThan(0);
  }
  for (const file of sandboxFiles) {
    const content = await readFile(output + file, 'utf8');
    expect(content).not.toContain('/Users/');
    expect(content).not.toContain('localStorage');
    expect(content).not.toContain('sessionStorage');
    expect(content).not.toContain('sendBeacon');
  }
});

test('isolated startup serves an empty snapshot and recovers when ccusage is missing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'almanac start '));
  let child;
  try {
    await mkdir(join(directory, 'public'));
    await mkdir(join(directory, '.data'));
    for (const file of ['server.js', 'public/data.js', 'public/index.html', 'public/style.css', 'public/app.js', 'public/agent-almanac-logo.svg', ...faviconFiles.map(name => 'public/' + name)]) await copyFile(root + file, join(directory, file));
    const saved = { daily: [], unpricedModels: [], updatedAt: '2026-08-03T00:00:00Z', timezone: 'UTC', pricing: 'offline' };
    await writeFile(join(directory, '.data/usage.json'), JSON.stringify(saved));
    child = Bun.spawn([process.execPath, 'server.js'], { cwd: directory, env: { ...process.env, PORT: '0' }, stdout: 'pipe', stderr: 'pipe' });
    const reader = child.stdout.getReader();
    let log = '';
    while (!/http:\/\/127\.0\.0\.1:\d+\//.test(log)) {
      const { value, done } = await reader.read();
      if (done) throw new Error('Server stopped: ' + await new Response(child.stderr).text());
      log += new TextDecoder().decode(value);
    }
    reader.releaseLock();
    const url = log.match(/http:\/\/127\.0\.0\.1:\d+\//)[0];
    expect(await (await fetch(url + 'api/usage')).json()).toEqual(saved);
    expect(await (await fetch(url)).text()).toContain('Agent Almanac');
    const logo = await fetch(url + 'agent-almanac-logo.svg');
    expect(logo.status).toBe(200);
    expect(logo.headers.get('content-type')).toContain('image/svg+xml');
    expect(await logo.text()).toBe(await readFile(root + 'public/agent-almanac-logo.svg', 'utf8'));
    for (const file of faviconFiles) {
      const response = await fetch(url + file);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain(file === 'site.webmanifest' ? 'application/manifest+json' : 'image/');
      expect(Buffer.from(await response.arrayBuffer())).toEqual(await readFile(root + 'public/' + file));
    }
    const failed = await fetch(url + 'api/usage', { method: 'POST' });
    expect(failed.status).toBe(503);
    expect((await failed.json()).error).toContain('bun install --frozen-lockfile');
    expect(await (await fetch(url + 'api/usage')).json()).toEqual(saved);
    expect((await fetch(url + '.data/usage.json')).status).toBe(404);
  } finally {
    if (child) { child.kill(); await child.exited; }
    await rm(directory, { recursive: true, force: true });
  }
}, 15000);
