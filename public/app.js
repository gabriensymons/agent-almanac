import { addDays, selectDays, groupDays, sumMetrics, agentTotals, cacheShare } from './data.js';

const $ = id => document.getElementById(id);
const sandbox = document.body.dataset.mode === 'sandbox';
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const compact = value => value == null ? 'Unavailable' : new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value);
const number = value => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
const money = value => value == null ? 'Unavailable' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
const percent = value => value == null ? '—' : `${(value * 100).toFixed(1)}%`;
const dateLabel = (date, year = false) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' }).format(new Date(date + 'T00:00:00Z'));
const names = { codex: 'Codex', hermes: 'Hermes', opencode: 'OpenCode', claude: 'Claude Code', claudecode: 'Claude Code', combined: 'Combined report' };
const name = agent => names[agent] ?? agent;
const palette = ['#216b53', '#8c79b8', '#c18340', '#4c88a5', '#b76374', '#777846'];
const tokenSeries = [
  { key: 'cacheReadTokens', label: 'Cache read', color: '#216b53' },
  { key: 'cacheCreationTokens', label: 'Cache write', color: '#8c79b8' },
  { key: 'inputTokens', label: 'Uncached input', color: '#c18340' },
  { key: 'outputTokens', label: 'Output', color: '#4c88a5' },
];
let report;
let days = [];
let buckets = [];
let series = [];
let selected = 0;
let state;
let colors = new Map();

function readState() {
  const params = new URLSearchParams(location.search);
  return {
    view: ['overview', 'tokens', 'cost'].includes(params.get('view')) ? params.get('view') : 'overview',
    range: ['30', '90', 'all'].includes(params.get('range')) ? params.get('range') : '90',
    agent: params.get('agent') || 'all',
    interval: params.get('interval') === 'weekly' ? 'weekly' : 'daily',
  };
}

function updateState(patch) {
  state = { ...state, ...patch };
  const params = new URLSearchParams(state);
  if (!sandbox) history.pushState(null, '', `?${params}`);
  render();
}

function totalFor(bucket) {
  if (state.view === 'cost') return bucket.totalCost;
  if (state.view === 'tokens') return tokenSeries.reduce((sum, s) => sum + bucket[s.key], 0);
  return bucket.totalTokens;
}

function valuesFor(bucket) {
  return series.map(s => state.view === 'tokens' ? bucket[s.key]
    : bucket.agents.find(a => a.agent === s.key)?.[state.view === 'cost' ? 'totalCost' : 'totalTokens'] ?? 0);
}

function formatMetric(value) { return state.view === 'cost' ? money(value) : `${compact(value)} tokens`; }

function stat(label, value, note) {
  return `<div class="stat"><p class="stat-label">${escape(label)}</p><p class="stat-number">${escape(value)}</p><p class="stat-note">${escape(note)}</p></div>`;
}

function render() {
  if (!report) return;
  const allAgents = [...new Set(report.daily.flatMap(day => day.agents.map(a => a.agent)))].sort();
  colors = new Map(allAgents.map((agent, i) => [agent, palette[i % palette.length]]));
  if (state.agent !== 'all' && !allAgents.includes(state.agent)) state.agent = 'all';
  $('agent').innerHTML = '<option value="all">All agents</option>' + allAgents.map(a => `<option value="${escape(a)}">${escape(name(a))}</option>`).join('');
  for (const key of ['agent', 'range', 'interval']) $(key).value = state[key];
  document.querySelectorAll('[data-view]').forEach(button => {
    if (button.dataset.view === state.view) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  $('cost-note').hidden = state.view !== 'cost';
  $('cost-note').textContent = report.source === 'example'
    ? 'Synthetic example · These costs are invented for demonstration. They are not current model prices or anyone’s bill.'
    : 'Experimental · ccusage cost estimates may use cached prices or include unpriced models. They do not represent your subscription bill or measure the value of your work.';
  $('pricing-note').hidden = state.view !== 'cost' || !report.unpricedModels.length;
  $('pricing-note').textContent = `Missing pricing reported for: ${report.unpricedModels.join(', ')}. Estimates may undercount usage cost.`;
  $('import-note').hidden = !report.warnings?.length;
  $('import-note').textContent = report.warnings?.join(' ') ?? '';
  const to = report.daily.at(-1)?.date;
  const first = report.daily[0]?.date;
  const from = !to ? undefined : state.range === 'all' ? first : [first, addDays(to, -Number(state.range) + 1)].sort().at(-1);
  days = to ? selectDays(report.daily, { from, to, agent: state.agent }) : [];
  // shortcut: daily marks are capped at two years; use weekly totals for longer histories.
  const interval = days.length > 730 ? 'weekly' : state.interval;
  buckets = groupDays(days, interval);
  const totals = sumMetrics(days);
  const agents = agentTotals(days);
  const recorded = days.filter(day => day.recorded);
  series = state.view === 'tokens' ? tokenSeries : agents.map(a => ({ key: a.agent, label: name(a.agent), color: colors.get(a.agent) }));
  selected = buckets.reduce((best, row, i) => (totalFor(row) ?? 0) > (totalFor(buckets[best]) ?? 0) ? i : best, 0);
  const topDay = recorded.reduce((best, day) => !best || (totalFor(day) ?? 0) > (totalFor(best) ?? 0) ? day : best, null);
  const span = from ? `${dateLabel(from, true)} – ${dateLabel(to, true)}` : 'No usage found';
  const recordNote = `${recorded.length} recorded days · ${days.length} calendar days`;
  const agentLabel = state.agent === 'all' ? 'All agents' : name(state.agent);
  $('range-label').textContent = `${span} · ${agentLabel} · ${interval === 'weekly' ? 'Weekly' : 'Daily'} totals`;
  $('chart-kicker').textContent = { overview: 'THE BIG PICTURE', tokens: 'UNDER THE HOOD', cost: 'EXPERIMENTAL ESTIMATES' }[state.view];
  $('chart-title').textContent = { overview: 'Usage over time', tokens: 'What makes up your tokens', cost: 'Estimated cost over time' }[state.view];
  if (state.view === 'overview') {
    $('summary').innerHTML = stat('Total tokens', compact(totals.totalTokens), report.source === 'example' ? 'Synthetic example data' : 'As reported by ccusage')
      + stat('Output tokens', compact(totals.outputTokens), 'Tokens generated by your agents')
      + stat('Recorded days', number(recorded.length), `Of ${days.length} calendar days`)
      + stat(agents.some(a => a.agent === 'combined') ? 'Agent breakdown' : 'Agents used', agents.some(a => a.agent === 'combined') ? 'Unavailable' : number(agents.length), agents.map(a => name(a.agent)).join(' · ') || 'No recorded agents');
  } else if (state.view === 'tokens') {
    $('summary').innerHTML = stat('Cache share of input', percent(cacheShare(totals)), 'Read ÷ (read + write + input)')
      + stat('Cache read', compact(totals.cacheReadTokens), 'Previously cached tokens')
      + stat('Cache write', compact(totals.cacheCreationTokens), 'Tokens added to cache')
      + stat('Uncached input', compact(totals.inputTokens), 'Input tokens reported separately');
  } else {
    $('summary').innerHTML = stat('Estimated cost · USD', money(totals.totalCost), report.source === 'example' ? 'Synthetic example costs' : 'Reported estimates · not your bill')
      + stat('Per recorded day', money(recorded.length && totals.totalCost !== null ? totals.totalCost / recorded.length : null), 'Mean for the selected window')
      + stat('Highest daily estimate', totals.totalCost === null ? 'Unavailable' : topDay ? money(topDay.totalCost) : '—', topDay ? dateLabel(topDay.date, true) : 'No recorded usage')
      + stat('Agents included', agents.some(a => a.agent === 'combined') ? 'Unknown' : number(agents.length), sandbox ? 'Only the displayed report' : 'Only locally detected usage');
  }
  $('legend').innerHTML = series.map(s => `<span><i class="swatch" style="background:${s.color}"></i>${escape(s.label)}</span>`).join('');
  $('chart-note').textContent = `${recordNote}. ${report.source === 'example' ? 'Synthetic data; all usage and costs are invented.' : 'Blank dates mean no recorded usage; they do not prove inactivity.'} ${report.timezone}. ${report.source === 'example' ? '' : 'The latest day may be incomplete.'}${days.length > 730 ? ' Long histories are grouped by week.' : ''}`;
  renderBreakdown(totals, agents);
  renderNote(totals, topDay, recorded, agents);
  $('table-caption').textContent = `${span} · ${agentLabel} · Dates with recorded usage`;
  $('cost-column').hidden = state.view !== 'cost';
  $('rows').innerHTML = recorded.slice().reverse().map(day => `<tr><th scope="row">${escape(dateLabel(day.date, true))}</th><td>${number(day.totalTokens)}</td><td>${number(day.outputTokens)}</td><td>${number(day.cacheReadTokens)}</td>${state.view === 'cost' ? `<td>${money(day.totalCost)}</td>` : ''}<td>${escape(day.agents.map(a => `${name(a.agent)}: ${a.modelsUsed.join(', ')}`).join(' · '))}</td></tr>`).join('');
  $('dashboard').setAttribute('aria-busy', 'false');
  draw();
}

function renderBreakdown(totals, agents) {
  const isTokens = state.view === 'tokens';
  $('breakdown-kicker').textContent = isTokens ? 'THE TOKEN MIX' : 'YOUR LINEUP';
  $('breakdown-title').textContent = isTokens ? 'By token type' : 'By agent';
  $('breakdown-subtitle').textContent = isTokens ? 'Share of the four reported token categories' : state.view === 'cost' ? 'Share of estimated cost · USD' : 'Share of recorded tokens';
  const entries = isTokens ? tokenSeries.map(s => ({ ...s, value: totals[s.key] }))
    : agents.map(a => ({ label: name(a.agent), color: colors.get(a.agent), value: state.view === 'cost' ? a.totalCost : a.totalTokens }));
  if (state.view === 'cost') entries.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const denominator = entries.reduce((sum, e) => sum + (e.value ?? 0), 0);
  const incomplete = entries.some(e => e.value === null);
  $('breakdown').innerHTML = entries.map(e => `<div class="rank-row"><div class="rank-label"><strong>${escape(e.label)}</strong><span>${escape(state.view === 'cost' ? money(e.value) : compact(e.value))} <span aria-hidden="true"> / </span> ${!incomplete && denominator ? percent(e.value / denominator) : '—'}</span></div><div class="track" aria-hidden="true"><div class="track-fill" style="width:${!incomplete && denominator ? e.value / denominator * 100 : 0}%;background:${e.color}"></div></div></div>`).join('') || '<p class="subtle">No recorded usage in this window.</p>';
}

function renderNote(totals, topDay, recorded, agents) {
  let kicker, title, value, body, foot;
  if (!recorded.length) {
    kicker = 'A CLEAN SLATE'; title = 'Your next session starts the story.'; value = '—';
    body = 'No usage was found for this selection. Try a different agent, a wider window, or another report.'; foot = 'ONLY THE AVAILABLE REPORT IS INCLUDED';
  } else if (state.view === 'tokens') {
    kicker = 'READING THE MIX'; title = 'Most tokens can be context.'; value = percent(cacheShare(totals));
    body = 'This share of input-side tokens was read from cache. It describes context reuse, not money saved. This view sums the four token categories; ccusage’s headline total can differ.';
    foot = 'TOKEN ACCOUNTING CAN VARY BETWEEN AGENTS';
  } else if (state.view === 'cost') {
    kicker = 'HANDLE WITH CONTEXT'; title = 'A cost estimate. A different kind of number.'; value = '';
    body = 'ccusage combines recorded usage with available pricing. Subscription plans, cached prices, missing prices, and provider accounting can all make this differ from what you actually pay. Use it to explore patterns.';
    foot = 'NO BUDGET FORECASTS OR BILLING CLAIMS';
  } else {
    kicker = 'A DAY THAT STANDS OUT'; title = `${dateLabel(topDay.date)} was your busiest recorded day.`; value = compact(topDay.totalTokens);
    body = `${agents.some(a => a.agent === 'combined') ? 'The report does not separate agents.' : `Tokens recorded across ${topDay.agents.length} ${topDay.agents.length === 1 ? 'agent' : 'agents'}.`} ${agents[0] && totals.totalTokens ? `${name(agents[0].agent)} accounts for ${percent(agents[0].totalTokens / totals.totalTokens)} of this window’s tokens.` : ''} Volume describes activity, not the quality of the work.`;
    foot = report.source === 'example' ? 'THE SELECTED WINDOW · SYNTHETIC DATA' : 'THE SELECTED WINDOW · YOUR REPORT';
  }
  $('field-note').innerHTML = `<div><p class="eyebrow">${escape(kicker)}</p><h2>${escape(title)}</h2>${value ? `<p class="note-number">${escape(value)}</p>` : ''}<p>${escape(body)}</p></div><div class="note-footer">${escape(foot)}</div>`;
}

function chartSvg(width, height, exporting = false) {
  const left = state.view === 'cost' ? 60 : 52, right = 12, top = 16, bottom = 37;
  const plotW = width - left - right, plotH = height - top - bottom;
  const max = Math.max(1, ...buckets.map(b => totalFor(b) ?? 0));
  const step = 10 ** Math.floor(Math.log10(max));
  const ceiling = Math.ceil(max / step * 2) / 2 * step;
  const barSpace = plotW / buckets.length;
  const barWidth = Math.max(.5, barSpace * .72);
  const y = value => top + plotH - value / ceiling * plotH;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ${exporting ? '' : 'tabindex="0" role="img" aria-labelledby="svg-title svg-desc"'} style="font-family:system-ui,sans-serif;font-variant-numeric:tabular-nums"><title id="svg-title">${escape($('chart-title').textContent)}</title><desc id="svg-desc">${escape($('range-label').textContent)}. Stacked bars. Use left and right arrow keys to inspect periods; daily values are also in the table below.</desc>`;
  for (let i = 0; i <= 4; i++) {
    const value = ceiling * i / 4;
    const label = state.view === 'cost' ? '$' + compact(value) : compact(value);
    svg += `<line x1="${left}" x2="${width - right}" y1="${y(value)}" y2="${y(value)}" stroke="#d9ded3" stroke-width=".7" shape-rendering="crispEdges"/><text x="${left - 10}" y="${y(value) + 4}" text-anchor="end" fill="#636e66" font-size="10">${label}</text>`;
  }
  buckets.forEach((bucket, i) => {
    let base = 0;
    const x = left + i * barSpace + (barSpace - barWidth) / 2;
    valuesFor(bucket).forEach((value, j) => {
      if (value > 0) {
        svg += `<rect x="${x}" y="${y(base + value)}" width="${barWidth}" height="${value / ceiling * plotH}" fill="${series[j].color}"><title>${escape(dateLabel(bucket.date))}: ${escape(series[j].label)} · ${escape(formatMetric(value))}</title></rect>`;
      }
      base += value;
    });
    if (!bucket.recorded) svg += `<circle cx="${x + barWidth / 2}" cy="${y(0) + 6}" r="1" fill="#a4ac9d"/>`;
  });
  const ticks = Math.min(buckets.length, width < 500 ? 3 : 7);
  for (let i = 0; i < ticks; i++) {
    const index = ticks === 1 ? 0 : Math.round(i * (buckets.length - 1) / (ticks - 1));
    const x = left + (index + .5) * barSpace;
    svg += `<text x="${x}" y="${height - 11}" text-anchor="${i === 0 ? 'start' : i === ticks - 1 ? 'end' : 'middle'}" fill="#636e66" font-size="10">${escape(dateLabel(buckets[index].date))}</text>`;
  }
  if (!exporting) svg += `<line id="selection-line" x1="0" x2="0" y1="${top}" y2="${top + plotH}" stroke="#202c29" stroke-width="1" stroke-dasharray="3 3" pointer-events="none"/>`;
  return svg + '</svg>';
}

function draw() {
  if (!report) return;
  const unavailable = state.view === 'cost' && buckets.some(b => b.totalCost === null || b.agents.some(a => a.totalCost === null));
  $('export').disabled = !buckets.length || unavailable;
  $('previous').disabled = $('next').disabled = !buckets.length || unavailable;
  if (!buckets.length || unavailable) {
    $('chart').innerHTML = `<div class="empty-chart">${unavailable ? 'Cost data is incomplete. Token usage is still available in the other views.' : sandbox ? 'No usage in this report. Choose another example or paste a daily report.' : 'No local usage found yet. Refresh after your next agent session.'}</div>`;
    $('inspection').textContent = unavailable ? 'Missing costs are not treated as zero.' : 'No periods to inspect.';
    return;
  }
  const width = Math.round($('chart').clientWidth), height = Math.round($('chart').clientHeight);
  $('chart').innerHTML = chartSvg(width, height);
  const svg = $('chart').querySelector('svg');
  const choose = event => {
    const bounds = svg.getBoundingClientRect();
    const left = state.view === 'cost' ? 60 : 52;
    selected = Math.max(0, Math.min(buckets.length - 1, Math.floor((event.clientX - bounds.left - left) / (bounds.width - left - 12) * buckets.length)));
    inspect();
  };
  svg.addEventListener('pointermove', event => { if (event.pointerType === 'mouse') choose(event); });
  svg.addEventListener('click', choose);
  svg.addEventListener('keydown', event => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      selected = event.key === 'Home' ? 0 : event.key === 'End' ? buckets.length - 1 : Math.max(0, Math.min(buckets.length - 1, selected + (event.key === 'ArrowRight' ? 1 : -1)));
      inspect();
    }
  });
  inspect();
}

function inspect() {
  const bucket = buckets[selected];
  if (!bucket) return;
  const label = bucket.date === bucket.end ? dateLabel(bucket.date, true) : `${dateLabel(bucket.date)} – ${dateLabel(bucket.end, true)}`;
  const values = valuesFor(bucket);
  $('inspection').innerHTML = `<strong>${escape(label)}</strong>${bucket.recorded ? `<b>${escape(formatMetric(totalFor(bucket)))}</b>` + series.map((s, i) => values[i] ? `<span>${escape(s.label)} <b>${escape(state.view === 'cost' ? money(values[i]) : compact(values[i]))}</b></span>` : '').join('') : '<span>No usage recorded</span>'}`;
  $('previous').disabled = selected === 0;
  $('next').disabled = selected === buckets.length - 1;
  const line = $('selection-line');
  if (line) {
    const width = $('chart').clientWidth, left = state.view === 'cost' ? 60 : 52;
    const x = left + (selected + .5) / buckets.length * (width - left - 12);
    line.setAttribute('x1', x); line.setAttribute('x2', x);
  }
}

async function load(refresh = false) {
  $('refresh').disabled = true;
  $('refresh').querySelector('span').textContent = 'Reading…';
  $('error').hidden = true;
  try {
    const response = await fetch('/api/usage', { method: refresh ? 'POST' : 'GET' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'The local report could not be loaded.');
    report = result;
    const updated = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: report.timezone }).format(new Date(report.updatedAt));
    $('source-status').textContent = `Local snapshot · ${updated}\nRefresh to read new usage`;
    render();
  } catch (error) {
    $('error').hidden = false;
    $('error').textContent = error.message;
    $('source-status').textContent = report ? 'Refresh failed · showing saved data' : 'Local report unavailable';
    if (!report) {
      $('summary').innerHTML = '<p class="loading">Start a session with a supported agent, then refresh to see your usage.</p>';
      $('dashboard').setAttribute('aria-busy', 'false');
    }
  } finally {
    $('refresh').disabled = false;
    $('refresh').querySelector('span').textContent = 'Refresh data';
  }
}

if (!sandbox) $('refresh').addEventListener('click', () => load(true));
for (const key of ['range', 'agent', 'interval']) $(key).addEventListener('change', event => updateState({ [key]: event.target.value }));
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => updateState({ view: button.dataset.view })));
for (const [id, delta] of [['previous', -1], ['next', 1]]) $(id).addEventListener('click', () => { selected = Math.max(0, Math.min(buckets.length - 1, selected + delta)); inspect(); });
window.addEventListener('popstate', () => { state = readState(); render(); });
new ResizeObserver(() => draw()).observe($('chart'));
$('export').addEventListener('click', () => {
  const width = 1100, extraLegendHeight = Math.max(0, Math.ceil(series.length / 4) - 1) * 20, height = 490 + extraLegendHeight;
  const subtitle = `${$('range-label').textContent} · ${state.view === 'cost' ? 'Estimated USD' : 'Tokens'}`;
  const chart = chartSvg(width - 60, 300, true).replace('<svg ', `<svg x="30" y="${125 + extraLegendHeight}" width="1040" height="300" `);
  const legend = series.map((s, i) => `<rect x="${32 + i % 4 * 260}" y="${104 + Math.floor(i / 4) * 20}" width="8" height="8" fill="${s.color}"/><text x="${46 + i % 4 * 260}" y="${112 + Math.floor(i / 4) * 20}" font-size="11">${escape(s.label)}</text>`).join('');
  const source = report.source === 'example' ? 'SYNTHETIC EXAMPLE · invented usage and costs' : report.source === 'pasted' ? 'Pasted ccusage report · values supplied by the user' : `ccusage · snapshot ${report.updatedAt.slice(0, 10)}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#fffefa"/><g font-family="system-ui,sans-serif" fill="#202c29"><text x="32" y="28" font-size="10" letter-spacing="2">AGENT ALMANAC / USAGE REPORT</text><text x="32" y="62" font-size="27">${escape($('chart-title').textContent)}</text><text x="32" y="84" font-size="12">${escape(subtitle)}</text>${legend}${chart}<text x="32" y="${451 + extraLegendHeight}" font-size="11">Source: ${escape(source)} · ${escape(report.timezone)}</text><text x="32" y="${474 + extraLegendHeight}" font-size="11">${state.view === 'cost' ? `Experimental estimate, not a bill. ${report.unpricedModels.length ? 'Some models have missing pricing.' : ''}` : 'Blank dates mean no recorded usage. Token volume does not measure productivity.'}</text></g></svg>`;
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `agent-almanac-${state.view}-${days[0].date}-${days.at(-1).date}.svg`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
state = sandbox ? { view: 'overview', range: '90', agent: 'all', interval: 'daily' } : readState();
if (sandbox) {
  $('sandbox-controls').hidden = false;
  $('refresh').hidden = true;
  document.querySelector('.version').textContent = 'SANDBOX';
  $('privacy-badge').textContent = 'Private in your browser';
  const { setupSandbox } = await import('./sandbox.js');
  setupSandbox(next => {
    report = next;
    $('source-status').textContent = next.source === 'example' ? `Synthetic example\n${next.label}` : 'Your pasted report\nVisible only in this tab';
    render();
  });
} else load();
