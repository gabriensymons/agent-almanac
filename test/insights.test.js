import { expect, test } from 'bun:test';
import * as data from '../public/data.js';
import { examples } from '../public/examples.js';

function history({ days = 60, start = '2026-08-03', weekends = false, values = (i, weekday) => ({ hermes: weekday === 3 ? 300 : 100 }) } = {}) {
  const daily = [];
  for (let i = 0; i < days; i++) {
    const date = data.addDays(start, i);
    const weekday = new Date(date + 'T00:00:00Z').getUTCDay();
    if (!weekends && [0, 6].includes(weekday)) continue;
    const agents = Object.entries(values(i, weekday)).map(([agent, totalTokens]) => ({
      agent, totalTokens, inputTokens: totalTokens, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalCost: null, modelsUsed: [],
    }));
    daily.push({ date, ...data.sumMetrics(agents), agents });
  }
  return data.normalizeReport({ daily }).daily;
}
const insights = (daily, selection = {}) => {
  expect(data.insightFacts).toBeFunction();
  return data.insightFacts(daily, data.comparisonFacts(daily, { range: '90', ...selection }));
};

const mixHistory = options => history({ values: i => i < 28 ? { hermes: 10, codex: 90 } : { hermes: 30, codex: 70 }, ...options });

test.each([119_999_999_999_999, 120_000_000_000_000])('weekday threshold uses exact large-integer averages: %s', high => {
  const daily = history({ values: (i, weekday) => ({ hermes: weekday === 3 ? high : 100_000_000_000_000 }) });
  expect(insights(daily).some(i => i.kind === 'weekday')).toBe(high === 120_000_000_000_000);
});

test.each([19_999_999_999_999, 20_000_000_000_000])('share threshold uses exact large-integer ratios: %s', recent => {
  const daily = mixHistory({ values: i => ({ hermes: i < 28 ? 10_000_000_000_000 : recent, codex: 100_000_000_000_000 - (i < 28 ? 10_000_000_000_000 : recent) }) });
  expect(insights(daily).some(i => i.kind === 'agent-mix')).toBe(recent === 20_000_000_000_000);
});

test.each([11, 12])('directional consistency requires two thirds of matched pairs: %s of 18', positive => {
  const daily = mixHistory().filter(day => !['2026-08-06', '2026-08-07', '2026-09-03', '2026-09-04'].includes(day.date));
  const recent = daily.filter(day => day.date >= '2026-08-31' && day.date <= '2026-09-27');
  recent.forEach((day, i) => {
    day.agents[0].inputTokens = day.agents[0].totalTokens = i < positive ? 30 : 10;
    day.agents[1].inputTokens = day.agents[1].totalTokens = 100 - day.agents[0].totalTokens;
    Object.assign(day, data.sumMetrics(day.agents));
  });
  const result = insights(data.normalizeReport({ daily }).daily).find(i => i.kind === 'agent-mix');
  expect(Boolean(result)).toBe(positive === 12);
  if (result) expect([result.pairedDays, result.risingDays, result.prior.recordedDays]).toEqual([18, 12, 18]);
});

test('uses the previous Sunday even when the latest report day is Sunday', () => {
  const result = insights(mixHistory({ days: 63, weekends: true })).find(i => i.kind === 'agent-mix');
  expect(result.recent.to).toBe('2026-09-27');
  expect(result.prior.from).toBe('2026-08-03');
});

test.each(['1900-01-01', '2024-01-15', '2026-10-01', '2099-11-01'])('keeps calendar windows valid around %s', start => {
  const daily = history({ start, days: 63, weekends: true, values: i => i < 32 ? { hermes: 10, codex: 90 } : { hermes: 30, codex: 70 } });
  const item = insights(daily).find(i => i.kind === 'agent-mix');
  expect(item).toBeDefined();
  expect(data.dateValid(item.prior.from)).toBe(true);
  expect(data.dateValid(item.recent.to)).toBe(true);
  expect(item.prior.from >= daily[0].date).toBe(true);
  expect(item.recent.to < daily.at(-1).date).toBe(true);
  expect(data.addDays(item.prior.to, 1)).toBe(item.recent.from);
});

test('keeps frozen inputs intact and suppresses missing or unsafe selected totals', () => {
  const daily = mixHistory();
  const comparison = data.comparisonFacts(daily);
  const before = JSON.stringify({ daily, comparison });
  const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } };
  freeze(daily); freeze(comparison);
  expect(data.insightFacts(daily, comparison).some(i => i.kind === 'agent-mix')).toBe(true);
  expect(JSON.stringify({ daily, comparison })).toBe(before);
  expect(insights(daily, { agent: 'missing' })).toEqual([]);
  expect(insights(history({ values: () => ({ hermes: Number.MAX_SAFE_INTEGER }) }))).toEqual([]);
  expect(insights([])).toEqual([]);
});

test('weekday facts follow the selected agent without moving the report anchor', () => {
  const daily = history({ values: (i, weekday) => i === 59 ? { codex: 1000 }
    : { hermes: weekday === 3 ? 300 : 100, codex: weekday === 2 ? 1000 : 100 } });
  expect(insights(daily).find(i => i.kind === 'weekday').weekday).toBe(2);
  expect(insights(daily, { agent: 'hermes' }).find(i => i.kind === 'weekday')).toEqual({
    kind: 'weekday', agent: 'hermes', weekday: 3, recordedDays: 9, recordedTokens: 2700,
  });
});

test('recognizes explicitly recorded zero agent share without inventing missing entries', () => {
  const daily = mixHistory({ values: i => i < 28 ? { hermes: 0, codex: 100 } : { hermes: 30, codex: 70 } });
  const result = insights(daily).find(i => i.kind === 'agent-mix');
  expect(result.prior.agentTokens).toBe(0);
  expect(result.recent.agentTokens).toBe(600);
});

test('breaks equal agent gains deterministically and respects the selected agent', () => {
  const daily = mixHistory({ values: i => i < 28 ? { zed: 10, alpha: 10, other: 80 } : { zed: 30, alpha: 30, other: 40 } });
  expect(insights(daily).find(i => i.kind === 'agent-mix').agent).toBe('alpha');
  expect(insights(daily, { agent: 'zed' }).find(i => i.kind === 'agent-mix').agent).toBe('zed');
});

test('does not reach outside the supported calendar for a short early report', () => {
  expect(insights(mixHistory({ start: '1900-01-01', days: 30 })).some(i => i.kind === 'agent-mix')).toBe(false);
});

test('requires exact daily agent attribution for share claims, even within normalizer tolerance', () => {
  const daily = mixHistory({ values: i => i < 28 ? { hermes: 200_000_000, codex: 1_800_000_000 } : { hermes: 600_000_000, codex: 1_400_000_000 } });
  daily[0].totalTokens--;
  daily[0].inputTokens--;
  const normalized = data.normalizeReport({ daily }).daily;
  expect(insights(normalized).some(i => i.kind === 'agent-mix')).toBe(false);
});

test.each(['mixed', 'cache'])('recognizes distributed observed share growth in the %s example', id => {
  const daily = data.normalizeReport(examples.find(example => example.id === id).report).daily;
  expect(insights(daily).find(i => i.kind === 'agent-mix')?.agent).toBe('hermes');
});

test('rejects a large share shift driven by one day even when most pairs rise a little', () => {
  const daily = mixHistory({ values: i => i < 28 ? { hermes: 10, codex: 90 }
    : i === 37 ? { hermes: 100_000, codex: 0 } : { hermes: 11, codex: 89 } });
  expect(insights(daily).some(i => i.kind === 'agent-mix')).toBe(false);
});

test('finds a repeated agent-share increase across matched completed four-week blocks', () => {
  const result = insights(mixHistory());
  expect(result).toEqual([{
    kind: 'agent-mix', agent: 'hermes', pairedDays: 20, risingDays: 20,
    prior: { from: '2026-08-03', to: '2026-08-30', recordedDays: 20, recordedTokens: 2000, agentTokens: 200 },
    recent: { from: '2026-08-31', to: '2026-09-27', recordedDays: 20, recordedTokens: 2000, agentTokens: 600 },
  }]);
});

test.each(['mismatched-gap', 'missing-agent', 'combined', 'zero-baseline', 'one-spike', 'weak-gain', 'too-few', 'too-few-positive'])('suppresses misleading agent-share growth: %s', kind => {
  let daily = mixHistory({ values: i => {
    if (kind === 'zero-baseline' && i < 28 || kind === 'too-few-positive' && i % 7 < 4) return { hermes: 0, codex: 0 };
    if (kind === 'one-spike') return i === 37 ? { hermes: 100_000, codex: 0 } : { hermes: 10, codex: 90 };
    return i < 28 ? { hermes: 10, codex: 90 } : kind === 'weak-gain' ? { hermes: 19, codex: 81 } : { hermes: 30, codex: 70 };
  } });
  if (kind === 'mismatched-gap') daily = daily.filter(day => day.date !== '2026-09-03');
  if (kind === 'too-few') daily = daily.filter(day => new Date(day.date + 'T00:00:00Z').getUTCDay() < 4);
  if (kind === 'missing-agent') {
    const day = daily.find(day => day.date === '2026-09-03');
    day.agents = day.agents.filter(a => a.agent !== 'hermes');
    Object.assign(day, data.sumMetrics(day.agents));
  }
  if (kind === 'combined') daily[0].agents.push({ ...daily[0].agents[0], agent: 'combined', inputTokens: 0, totalTokens: 0 });
  daily = data.normalizeReport({ daily }).daily;
  expect(insights(daily).filter(value => value.kind === 'agent-mix')).toEqual([]);
});

test('keeps mix evidence inside the selected window and uses the all-agent denominator for a selected agent', () => {
  const daily = mixHistory();
  expect(insights(daily, { range: '30' }).some(i => i.kind === 'agent-mix')).toBe(false);
  expect(insights(daily, { agent: 'codex' }).some(i => i.kind === 'agent-mix')).toBe(false);
  expect(insights(daily, { agent: 'hermes' }).find(i => i.kind === 'agent-mix')).toEqual(insights(daily).find(i => i.kind === 'agent-mix'));
});

test.each(['weak', 'tie', 'spike', 'short', 'one-weekday', 'sparse-rival', 'zero'])('does not invent a weekday rhythm: %s', kind => {
  let daily = history({
    days: kind === 'short' ? 18 : 60,
    values: (i, weekday) => ({ hermes: kind === 'zero' ? 0 : kind === 'spike' ? (i === 2 ? 10_000 : 100)
      : weekday === 3 ? (kind === 'weak' ? 119 : 300) : kind === 'tie' && weekday === 4 ? 300 : 100 }),
  });
  if (kind === 'one-weekday') daily = daily.filter(day => new Date(day.date + 'T00:00:00Z').getUTCDay() === 3);
  if (kind === 'sparse-rival') daily = daily.filter(day => new Date(day.date + 'T00:00:00Z').getUTCDay() !== 2 || day.date === '2026-08-04');
  expect(insights(daily)).toEqual([]);
});

test('ranks weekday averages rather than unequal observation totals', () => {
  const daily = history({ values: (i, weekday) => ({ hermes: weekday === 1 ? 400 : 300 }) })
    .filter(day => {
      const weekday = new Date(day.date + 'T00:00:00Z').getUTCDay();
      return weekday === 3 || weekday === 1 && day.date <= '2026-08-24';
    });
  expect(insights(daily)).toEqual([{ kind: 'weekday', agent: 'all', weekday: 1, recordedDays: 4, recordedTokens: 1600 }]);
});

test('finds a weekday rhythm without treating omitted weekends or the latest day as zero', () => {
  const daily = history({ values: (i, weekday) => ({ hermes: i === 59 ? 1_000_000 : weekday === 3 ? 300 : 100 }) });
  expect(insights(daily)).toEqual([{ kind: 'weekday', agent: 'all', weekday: 3, recordedDays: 9, recordedTokens: 2700 }]);
});
