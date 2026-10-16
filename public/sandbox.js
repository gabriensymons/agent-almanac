import { examples } from './examples.js';
import { parseUsage } from './import.js';

export function setupSandbox(show) {
  const select = document.getElementById('example');
  const input = document.getElementById('paste-report');
  const error = document.getElementById('import-error');
  select.replaceChildren(...examples.map(example => new Option(example.label, example.id)));
  const sample = () => {
    const example = examples.find(item => item.id === select.value) ?? examples[0];
    input.value = '';
    error.hidden = true;
    show({ ...parseUsage(JSON.stringify(example.report)), source: 'example', label: example.label, timezone: 'Example dates · UTC', pricing: 'synthetic' });
  };
  select.addEventListener('change', sample);
  document.getElementById('clear-paste').addEventListener('click', sample);
  document.getElementById('use-example').addEventListener('click', () => {
    input.value = JSON.stringify(examples.find(item => item.id === select.value).report, null, 2);
    error.hidden = true;
  });
  document.getElementById('preview-paste').addEventListener('click', () => {
    try {
      const report = parseUsage(input.value);
      show({ ...report, source: 'pasted', label: 'Your pasted report', timezone: 'Report dates · timezone not supplied', pricing: 'imported' });
      error.hidden = true;
    } catch (cause) {
      error.textContent = cause.message;
      error.hidden = false;
    }
  });
  // Clear sensitive input before a page can enter the browser's back/forward cache.
  window.addEventListener('pagehide', sample);
  sample();
}
