import { normalizeReport, tokenFields, sumMetrics } from './data.js';

const fields = [...tokenFields, 'totalTokens', 'totalCost'];
const tableHint = 'Paste the complete wide daily table, including its header and Total row, or use ccusage daily --json --by-agent.';

function tableNumber(value, cost = false) {
  const text = value.replace(/^\$/, '');
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text)) throw new Error('A table value is missing or abbreviated. ' + tableHint);
  const number = Number(text.replaceAll(',', ''));
  if (!Number.isFinite(number) || (!cost && !Number.isSafeInteger(number))) throw new Error('Invalid table number. ' + tableHint);
  return number;
}

function parseTable(text) {
  let header, day, agent, total;
  const daily = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim().startsWith('│')) continue;
    const cells = line.split('│').slice(1, -1).map(cell => cell.trim());
    if (cells[0] === 'Date') {
      if (header) throw new Error('Paste one daily report at a time.');
      header = cells;
      const labels = ['Date', 'Agent', 'Models', 'Input', 'Output', 'Cache Create', 'Cache Read', 'Total Tokens'];
      if (!labels.every((label, i) => cells[i]?.replace(/\s+/g, ' ') === label) || ![8, 9].includes(cells.length)
          || (cells.length === 9 && cells[8] !== 'Cost (USD)')) throw new Error('Unsupported table layout. ' + tableHint);
      continue;
    }
    if (!header || cells.every(cell => !cell)) continue;
    if (total || cells.length !== header.length) throw new Error('Unexpected or wrapped table row. ' + tableHint);
    const [date, agentName, model] = cells;
    if (!date && !agentName) {
      if (!agent || !model.startsWith('- ') || cells.slice(3).some(Boolean)) throw new Error('Unrecognized continuation row. ' + tableHint);
      agent.modelsUsed.push(model.slice(2));
      continue;
    }
    const values = Object.fromEntries(fields.map((key, i) => [key, key === 'totalCost' && header.length === 8 ? null : tableNumber(cells[i + 3], key === 'totalCost')]));
    if (date === 'Total') { total = values; continue; }
    if (date && agentName === 'All') {
      day = { period: date, ...values, agents: [] };
      daily.push(day); agent = undefined;
    } else if (!date && day && agentName.startsWith('- ')) {
      agent = { agent: agentName.slice(2).toLowerCase().replaceAll(' ', ''), ...values, modelsUsed: model ? [model.replace(/^- /, '')] : [] };
      day.agents.push(agent);
    } else throw new Error('Unsupported daily table row. ' + tableHint);
  }
  if (!header || !total || !daily.length || daily.some(row => !row.agents.length)) throw new Error(tableHint);
  const sum = sumMetrics(daily);
  for (const field of fields) {
    if (sum[field] === null && total[field] === null) continue;
    const tolerance = field === 'totalCost' ? (daily.length + 1) * 0.005 + 1e-9 : 0;
    if (Math.abs(sum[field] - total[field]) > tolerance) throw new Error('The table totals do not match. Some rows may be missing. ' + tableHint);
  }
  return normalizeReport({ daily }, { roundedCosts: true });
}

export function parseUsage(input) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('Paste a ccusage daily report first.');
  if (new TextEncoder().encode(input).length > 2 * 1024 * 1024) throw new Error('Please paste a smaller report (up to 2 MB).');
  const text = input.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').trim();
  if (!text.startsWith('{')) return { ...parseTable(text), warnings: ['Terminal costs are rounded. Small differences from JSON estimates are expected. Pricing availability is not included in terminal tables.'] };
  let raw;
  try { raw = JSON.parse(text); }
  catch { throw new Error('That JSON is incomplete or invalid. Paste the full output of ccusage daily --json --by-agent.'); }
  if (!Array.isArray(raw.daily)) throw new Error('Expected a daily report. Use ccusage daily --json --by-agent.');
  let combined = false;
  const daily = raw.daily.map(row => {
    if (!row || typeof row !== 'object') throw new Error('Invalid daily record.');
    if (row.agents !== undefined) return row;
    const source = typeof row.agent === 'string' && row.agent !== 'all' ? row.agent : 'combined';
    combined ||= source === 'combined';
    return { ...row, agents: [{ ...row, agent: source, modelsUsed: row.modelsUsed ?? [] }] };
  });
  return { ...normalizeReport({ daily, totals: raw.totals }), warnings: combined ? ['This report has no agent breakdown. Combined totals are shown; use --by-agent to compare agents.'] : [] };
}
