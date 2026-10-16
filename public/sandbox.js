import { examples } from './examples.js';
import { parseUsage } from './import.js';

export function setupSandbox(show) {
  const select = document.getElementById('example');
  const input = document.getElementById('paste-report');
  const error = document.getElementById('import-error');
  const status = document.getElementById('import-status');
  const buildButton = document.getElementById('preview-paste');
  input.addEventListener('input', () => {
    buildButton.textContent = 'Build my dashboard';
    status.textContent = '';
  });
  const command = document.getElementById('ccusage-command');
  const commandFeedback = document.getElementById('command-status');
  const copyButton = document.getElementById('copy-command');
  const terminal = document.getElementById('command-platform');
  const baseCommand = command.value;
  const commands = { mac: `${baseCommand} | pbcopy`, windows: `${baseCommand} | Set-Clipboard`, plain: baseCommand };
  terminal.value = /Mac/.test(navigator.platform) ? 'mac' : /Win/.test(navigator.platform) ? 'windows' : 'plain';
  const updateCommand = () => {
    command.value = commands[terminal.value] ?? baseCommand;
    commandFeedback.textContent = '';
    copyButton.textContent = 'Copy command';
    document.getElementById('command-help').textContent = terminal.value === 'plain'
      ? 'Run this in your terminal, then copy the complete JSON output.'
      : 'Run this in your terminal. On success, the JSON goes straight to your clipboard, so there is no report to scroll through. Return here and paste it below.';
  };
  terminal.addEventListener('change', updateCommand);
  updateCommand();
  const pastePanel = document.getElementById('paste-panel');
  const pasteToggle = document.getElementById('paste-toggle');
  pasteToggle.addEventListener('click', () => {
    pastePanel.hidden = !pastePanel.hidden;
    pasteToggle.setAttribute('aria-expanded', String(!pastePanel.hidden));
    if (!pastePanel.hidden) document.getElementById('paste-heading').focus();
  });
  copyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(command.value);
      copyButton.textContent = 'Copied!';
      commandFeedback.textContent = 'Command copied. Run it in your terminal, then paste the report below.';
    } catch {
      copyButton.textContent = 'Copy command';
      command.focus();
      command.select();
      commandFeedback.textContent = 'Automatic copy is unavailable. Press ⌘C (Mac) or Ctrl+C to copy the selected command.';
    }
  });
  select.replaceChildren(...examples.map(example => new Option(example.label, example.id)));
  const sample = () => {
    const example = examples.find(item => item.id === select.value) ?? examples[0];
    input.value = '';
    buildButton.textContent = 'Build my dashboard';
    error.hidden = true;
    status.textContent = '';
    show({ ...parseUsage(JSON.stringify(example.report)), source: 'example', label: example.label, timezone: 'Example dates · UTC', pricing: 'synthetic' });
  };
  select.addEventListener('change', sample);
  document.getElementById('clear-paste').addEventListener('click', sample);
  document.getElementById('use-example').addEventListener('click', () => {
    input.value = JSON.stringify(examples.find(item => item.id === select.value).report, null, 2);
    buildButton.textContent = 'Build my dashboard';
    error.hidden = true;
    status.textContent = 'Loaded the selected example’s JSON. Building it unchanged will show the same chart.';
  });
  buildButton.addEventListener('click', () => {
    buildButton.textContent = 'Build my dashboard';
    status.textContent = '';
    try {
      const report = parseUsage(input.value);
      show({ ...report, source: 'pasted', label: 'Your pasted report', timezone: 'Report dates · timezone not supplied', pricing: 'imported' });
      error.hidden = true;
      buildButton.textContent = 'Built dashboard!';
      status.textContent = '✓ Dashboard updated from the report above.';
    } catch (cause) {
      error.textContent = cause.message;
      error.hidden = false;
    }
  });
  // Clear sensitive input before a page can enter the browser's back/forward cache.
  window.addEventListener('pagehide', sample);
  sample();
}
