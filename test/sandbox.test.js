import { afterEach, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { setupSandbox } from '../public/sandbox.js';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const originalGlobals = new Map(['document', 'window', 'Option', 'navigator'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));

afterEach(() => {
  for (const [key, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});

function mount(clipboard, platform = 'Linux') {
  // Fake only browser boundaries; report parsing and sandbox event handlers stay real.
  const nodes = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => [id, {
    value: '', hidden: true, textContent: '', attributes: {}, listeners: {},
    addEventListener(type, listener) { this.listeners[type] = listener; },
    replaceChildren(...options) { this.value = options[0]?.value ?? ''; },
    setAttribute(key, value) { this.attributes[key] = value; },
    focus() { this.focused = true; },
    select() { this.selected = true; },
  }]));
  nodes.get('ccusage-command').value = html.match(/id="ccusage-command"[^>]*>([^<]+)<\/textarea>/)[1];
  for (const [key, value] of Object.entries({
    document: { getElementById: id => nodes.get(id) },
    window: { addEventListener() {} },
    Option: class { constructor(label, value) { this.label = label; this.value = value; } },
    navigator: { clipboard, platform },
  })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  setupSandbox(() => {});
  return { node: id => nodes.get(id), click: id => nodes.get(id).listeners.click(), change: (id, value) => { nodes.get(id).value = value; nodes.get(id).listeners.change(); } };
}

test('the paste choice opens the form with keyboard focus and reports its expanded state', () => {
  const ui = mount({});
  expect(html).toContain('aria-controls="paste-panel"');
  ui.click('paste-toggle');
  expect(ui.node('paste-panel').hidden).toBe(false);
  expect(ui.node('paste-toggle').attributes['aria-expanded']).toBe('true');
  expect(ui.node('paste-heading').focused).toBe(true);
  ui.click('paste-toggle');
  expect(ui.node('paste-panel').hidden).toBe(true);
  expect(ui.node('paste-toggle').attributes['aria-expanded']).toBe('false');
});

test('copy sends the visible daily JSON command to the clipboard and confirms success', async () => {
  let copied;
  const ui = mount({ writeText: async value => { copied = value; } });
  await ui.click('copy-command');
  expect(copied).toBe('bunx ccusage daily --json --by-agent');
  expect(ui.node('copy-command').textContent).toBe('Copied!');
  expect(ui.node('command-status').textContent).toContain('Command copied.');
});

test('a rejected clipboard write selects the command and explains manual copying', async () => {
  let denied = false;
  const ui = mount({ writeText: async () => { if (denied) throw new Error('Clipboard denied'); } });
  await ui.click('copy-command');
  denied = true;
  await ui.click('copy-command');
  expect(ui.node('copy-command').textContent).toBe('Copy command');
  expect(ui.node('ccusage-command').focused).toBe(true);
  expect(ui.node('ccusage-command').selected).toBe(true);
  expect(ui.node('command-status').textContent).toContain('Ctrl+C');
});

test.each([
  ['MacIntel', 'mac', ' | pbcopy'],
  ['Win32', 'windows', ' | Set-Clipboard'],
  ['Linux x86_64', 'plain', ''],
])('the initial terminal command matches %s', async (platform, option, suffix) => {
  let copied;
  const ui = mount({ writeText: async value => { copied = value; } }, platform);
  expect(ui.node('command-platform').value).toBe(option);
  await ui.click('copy-command');
  expect(copied).toBe('bunx ccusage daily --json --by-agent' + suffix);
});

test('changing terminals updates the command and clears stale copy feedback', async () => {
  const ui = mount({ writeText: async () => {} }, 'MacIntel');
  await ui.click('copy-command');
  ui.change('command-platform', 'windows');
  expect(ui.node('ccusage-command').value).toEndWith(' | Set-Clipboard');
  expect(ui.node('command-status').textContent).toBe('');
  expect(ui.node('copy-command').textContent).toBe('Copy command');
  expect(ui.node('command-help').textContent).toContain('straight to your clipboard');
  ui.change('command-platform', 'plain');
  expect(ui.node('ccusage-command').value).toBe('bunx ccusage daily --json --by-agent');
  expect(ui.node('command-help').textContent).toContain('copy the complete JSON output');
});

test('build confirms success, resets on editing, and does not claim success for invalid input', () => {
  const ui = mount({});
  ui.click('use-example');
  ui.click('preview-paste');
  expect(ui.node('preview-paste').textContent).toBe('Built dashboard!');
  expect(ui.node('import-status').textContent).toContain('✓ Dashboard updated');

  ui.node('paste-report').value = '{invalid';
  ui.node('paste-report').listeners.input();
  expect(ui.node('preview-paste').textContent).toBe('Build my dashboard');
  expect(ui.node('import-status').textContent).toBe('');
  ui.click('preview-paste');
  expect(ui.node('preview-paste').textContent).toBe('Build my dashboard');
  expect(ui.node('import-error').hidden).toBe(false);
});

test('refilling, clearing, and switching examples reset the built label', () => {
  const ui = mount({});
  for (const reset of [() => ui.click('use-example'), () => ui.click('clear-paste'), () => ui.change('example', 'solo')]) {
    ui.click('use-example');
    ui.click('preview-paste');
    expect(ui.node('preview-paste').textContent).toBe('Built dashboard!');
    reset();
    expect(ui.node('preview-paste').textContent).toBe('Build my dashboard');
  }
});
