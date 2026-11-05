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

// Normalized rows and their matching comparisonFacts result; never fill missing records.
export function insightFacts(daily, comparison) {
  const { current, agent } = comparison;
  if (!current?.recordedDays || current.recordedTokens === null) return [];
  const rows = daily.filter(day => day.date >= current.from && day.date < current.to && day.agents.length)
    .flatMap(day => {
      const entry = agent === 'all' ? day : day.agents.find(value => value.agent === agent);
      return entry ? [{ date: day.date, tokens: entry.totalTokens }] : [];
    });
  return [weekdayInsight(rows, agent), agentMixInsight(daily, current, agent)].filter(Boolean);
}

function weekdayInsight(rows, agent) {
  const groups = new Map();
  for (const row of rows) {
    const weekday = new Date(row.date + 'T00:00:00Z').getUTCDay();
    if (!groups.has(weekday)) groups.set(weekday, { weekday, total: 0, values: [] });
    const group = groups.get(weekday);
    group.total += row.tokens;
    group.values.push(row.tokens);
  }
  const ranked = [...groups.values()].sort((a, b) => {
    const delta = BigInt(b.total) * BigInt(a.values.length) - BigInt(a.total) * BigInt(b.values.length);
    return delta > 0n ? 1 : delta < 0n ? -1 : a.weekday - b.weekday;
  });
  if (ranked.length < 2 || ranked.some(group => group.values.length < 4 || !Number.isSafeInteger(group.total))) return null;
  const [best, next] = ranked;
  if (!best.total || BigInt(best.total) * BigInt(next.values.length) * 5n < BigInt(next.total) * BigInt(best.values.length) * 6n) return null;
  const trimmed = group => BigInt(group.total - Math.max(...group.values));
  if (ranked.slice(1).some(group => trimmed(best) * BigInt(group.values.length - 1) <= trimmed(group) * BigInt(best.values.length - 1))) return null;
  return { kind: 'weekday', agent, weekday: best.weekday, recordedDays: best.values.length, recordedTokens: best.total };
}

function agentMixInsight(daily, current, selectedAgent) {
  // Two completed Monday–Sunday blocks, never the possibly incomplete report week.
  const weekday = new Date(current.to + 'T00:00:00Z').getUTCDay();
  const recentTo = addDays(current.to, -(weekday || 7));
  const recentFrom = addDays(recentTo, -27);
  const priorTo = addDays(recentFrom, -1), priorFrom = addDays(priorTo, -27);
  if (!dateValid(priorFrom) || priorFrom < current.from) return null;
  const observed = (from, to) => daily.filter(day => day.date >= from && day.date <= to && day.agents.length);
  const priorRows = observed(priorFrom, priorTo), recentRows = observed(recentFrom, recentTo);
  if (priorRows.length < 16 || priorRows.length !== recentRows.length
    || priorRows.some((day, i) => addDays(day.date, 28) !== recentRows[i].date)) return null;
  const both = [...priorRows, ...recentRows];
  if (both.some(day => day.agents.some(a => a.agent === 'combined')
    || day.agents.reduce((sum, a) => sum + BigInt(a.totalTokens), 0n) !== BigInt(day.totalTokens))) return null;
  const total = rows => rows.reduce((sum, day) => sum + day.totalTokens, 0);
  const priorTotal = total(priorRows), recentTotal = total(recentRows);
  if (![priorTotal, recentTotal].every(value => Number.isSafeInteger(value) && value > 0)) return null;
  const denominator = BigInt(priorTotal) * BigInt(recentTotal);
  const candidates = priorRows[0].agents.map(a => a.agent).filter(a => selectedAgent === 'all' || a === selectedAgent).sort();
  let best = null, bestGain = 0n;
  for (const agent of candidates) {
    if (!both.every(day => day.agents.some(a => a.agent === agent))) continue;
    const tokens = day => day.agents.find(a => a.agent === agent).totalTokens;
    const priorTokens = priorRows.reduce((sum, day) => sum + tokens(day), 0);
    const recentTokens = recentRows.reduce((sum, day) => sum + tokens(day), 0);
    if (![priorTokens, recentTokens].every(Number.isSafeInteger)) continue;
    const gain = BigInt(recentTokens) * BigInt(priorTotal) - BigInt(priorTokens) * BigInt(recentTotal);
    if (gain * 10n < denominator || gain <= bestGain) continue;
    let pairedDays = 0, risingDays = 0;
    priorRows.forEach((prior, i) => {
      const recent = recentRows[i];
      if (!prior.totalTokens || !recent.totalTokens) return;
      pairedDays++;
      const dayGain = BigInt(tokens(recent)) * BigInt(prior.totalTokens) - BigInt(tokens(prior)) * BigInt(recent.totalTokens);
      if (dayGain > 0n) risingDays++;
    });
    if (pairedDays < 12 || risingDays * 3 < pairedDays * 2) continue;
    // The increase must survive removing any one day from either block.
    const highPrior = leaveOneOutShare(priorRows, priorTotal, priorTokens, tokens, false);
    const lowRecent = leaveOneOutShare(recentRows, recentTotal, recentTokens, tokens, true);
    if (!highPrior || !lowRecent || (lowRecent.n * highPrior.d - highPrior.n * lowRecent.d) * 20n < highPrior.d * lowRecent.d) continue;
    bestGain = gain;
    best = {
      kind: 'agent-mix', agent, pairedDays, risingDays,
      prior: { from: priorFrom, to: priorTo, recordedDays: priorRows.length, recordedTokens: priorTotal, agentTokens: priorTokens },
      recent: { from: recentFrom, to: recentTo, recordedDays: recentRows.length, recordedTokens: recentTotal, agentTokens: recentTokens },
    };
  }
  return best;
}

function leaveOneOutShare(rows, total, agentTotal, tokens, minimum) {
  let best;
  for (const day of rows) {
    const fraction = { n: BigInt(agentTotal - tokens(day)), d: BigInt(total - day.totalTokens) };
    if (!fraction.d) return null;
    if (!best || (minimum ? fraction.n * best.d < best.n * fraction.d : fraction.n * best.d > best.n * fraction.d)) best = fraction;
  }
  return best;
}

// Accept normalized, sorted daily data; missing observations are not measured zeroes.
export function comparisonFacts(daily, { range = '90', agent = 'all' } = {}) {
  if (!['30', '90', 'all'].includes(range)) throw new RangeError('Unsupported comparison range.');
  if (typeof agent !== 'string' || !agent) throw new TypeError('Expected a nonempty agent selector.');
  if (!daily.length) return {
    status: 'empty-report', range, agent, current: null, previous: null, delta: null, caveats: [],
  };
  const to = daily.at(-1).date;
  const windowDays = range === 'all' ? null : Number(range);
  const nominalFrom = windowDays === null ? daily[0].date : addDays(to, 1 - windowDays);
  const period = (from, to) => {
    if (!dateValid(from) || !dateValid(to)) return null;
    const days = selectDays(daily, { from, to, agent });
    const recorded = days.filter(day => day.recorded);
    const total = recorded.reduce((sum, day) => sum + day.totalTokens, 0);
    return {
      from, to, calendarDays: days.length, recordedDays: recorded.length,
      recordedTokens: recorded.length && Number.isSafeInteger(total) ? total : null,
    };
  };
  const current = period(daily[0].date > nominalFrom ? daily[0].date : nominalFrom, to);
  const previous = windowDays === null ? null : period(addDays(nominalFrom, -windowDays), addDays(nominalFrom, -1));
  const caveats = [];
  if (windowDays !== null && current.calendarDays < windowDays) caveats.push('partial-current-window');
  if (!current.recordedDays) caveats.push('no-current-records');
  if (current.recordedDays < current.calendarDays) caveats.push('current-gaps');
  if (range !== 'all' && !previous) caveats.push('previous-out-of-range');
  if (previous && previous.recordedDays < previous.calendarDays) caveats.push('previous-gaps');
  if ([current, previous].some(value => value?.recordedDays && value.recordedTokens === null)) caveats.push('unsafe-total');
  const comparable = range !== 'all' && caveats.length === 0;
  const tokens = comparable ? current.recordedTokens - previous.recordedTokens : null;
  if (comparable && previous.recordedTokens === 0) caveats.push('zero-baseline');
  return {
    status: range === 'all' && current.recordedDays ? 'all-history' : comparable ? 'comparable' : 'insufficient-data',
    range, agent, current, previous,
    delta: comparable ? { tokens, ratio: previous.recordedTokens ? tokens / previous.recordedTokens : null } : null,
    caveats: [...caveats, 'latest-day-may-be-incomplete'],
  };
}
