export const tokenFields = ['inputTokens', 'outputTokens', 'cacheCreationTokens', 'cacheReadTokens'];
const fields = [...tokenFields, 'totalTokens', 'totalCost'];
export const emptyTotals = () => Object.fromEntries(fields.map(key => [key, 0]));

export function dateValid(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && value >= '1900-01-01' && value <= '2100-12-31'
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

export function addDays(value, count) {
  const date = new Date(value + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

function metrics(row) {
  const result = {};
  for (const key of fields) {
    const value = row[key];
    if (key === 'totalCost' && value == null) { result[key] = null; continue; }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (key !== 'totalCost' && !Number.isSafeInteger(value))) {
      throw new Error(`Invalid or missing ${key} in ccusage report.`);
    }
    result[key] = value;
  }
  return result;
}

export function normalizeReport(report, { roundedCosts = false } = {}) {
  if (!report || !Array.isArray(report.daily)) throw new Error('Expected a ccusage daily JSON report.');
  if (report.daily.length > 10000) throw new Error('Please limit the report to 10,000 recorded days.');
  const seen = new Set();
  const sources = new Set();
  const daily = report.daily.map(row => {
    if (!row || typeof row !== 'object') throw new Error('Invalid daily record.');
    const date = row.period ?? row.date;
    if (!dateValid(date) || seen.has(date)) throw new Error('Invalid or duplicate report date.');
    seen.add(date);
    if (!Array.isArray(row.agents)) throw new Error('Agent breakdowns are missing. Run ccusage daily --json --by-agent.');
    const agents = row.agents.map(agent => {
      if (!agent || typeof agent !== 'object') throw new Error('Invalid agent record.');
      if (typeof agent.agent !== 'string' || !agent.agent || agent.agent.length > 80) throw new Error('Invalid agent name.');
      sources.add(agent.agent);
      if (sources.size > 32) throw new Error('Please limit the report to 32 distinct agents.');
      if (!Array.isArray(agent.modelsUsed) || agent.modelsUsed.some(model => typeof model !== 'string' || model.length > 200)) throw new Error('Invalid model names.');
      return { agent: agent.agent, ...metrics(agent), modelsUsed: agent.modelsUsed };
    });
    if (new Set(agents.map(a => a.agent)).size !== agents.length) throw new Error('Duplicate agent in report.');
    for (const key of fields) {
      if (row[key] == null || agents.some(a => a[key] == null)) continue;
      const sum = agents.reduce((total, agent) => total + agent[key], 0);
      const tolerance = key === 'totalCost' && roundedCosts ? (agents.length + 1) * 0.005 + 1e-9 : Math.max(0.00001, row[key] * 1e-9);
      if (Math.abs(sum - row[key]) > tolerance) throw new Error(`Agent ${key} totals do not match the daily report.`);
    }
    return { date, ...metrics(row), agents };
  }).sort((a, b) => a.date.localeCompare(b.date));
  if (daily.length && (Date.parse(daily.at(-1).date) - Date.parse(daily[0].date)) / 86400000 > 36600) {
    throw new Error('Report date range exceeds 100 years.');
  }
  const unpricedModels = report.totals?.unpricedModels ?? [];
  if (!Array.isArray(unpricedModels) || unpricedModels.some(m => typeof m !== 'string')) throw new Error('Invalid pricing metadata.');
  return { daily, unpricedModels };
}

export function sumMetrics(rows) {
  const sum = emptyTotals();
  for (const row of rows) for (const key of fields) {
    sum[key] = sum[key] === null || row[key] == null ? null : sum[key] + row[key];
  }
  return sum;
}

export function selectDays(daily, { from, to, agent = 'all' }) {
  if (!dateValid(from) || !dateValid(to) || from > to) return [];
  const byDate = new Map(daily.map(day => [day.date, day]));
  const result = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const day = byDate.get(date);
    const agents = (day?.agents ?? []).filter(a => agent === 'all' || a.agent === agent);
    const totals = agent === 'all' && day ? Object.fromEntries(fields.map(key => [key, day[key]])) : sumMetrics(agents);
    result.push({ date, ...totals, agents, recorded: agents.length > 0 });
  }
  return result;
}

export function groupDays(days, interval) {
  if (interval === 'daily') return days.map(day => ({ ...day, end: day.date }));
  const buckets = new Map();
  for (const day of days) {
    const weekday = new Date(day.date + 'T00:00:00Z').getUTCDay();
    const key = addDays(day.date, -((weekday + 6) % 7));
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(day);
  }
  return [...buckets.values()].map(rows => ({
    date: rows[0].date, end: rows.at(-1).date, ...sumMetrics(rows),
    recorded: rows.some(row => row.recorded), agents: agentTotals(rows),
  }));
}

export function agentTotals(days) {
  const groups = new Map();
  for (const day of days) for (const agent of day.agents) {
    if (!groups.has(agent.agent)) groups.set(agent.agent, []);
    groups.get(agent.agent).push(agent);
  }
  return [...groups].map(([agent, rows]) => ({ agent, ...sumMetrics(rows) }))
    .sort((a, b) => b.totalTokens - a.totalTokens);
}

export function cacheShare(totals) {
  const inputs = totals.inputTokens + totals.cacheCreationTokens + totals.cacheReadTokens;
  return inputs ? totals.cacheReadTokens / inputs : null;
}
