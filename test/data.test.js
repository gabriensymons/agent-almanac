import { describe, test, expect } from 'bun:test';
import { normalizeReport, selectDays, groupDays, sumMetrics, agentTotals, cacheShare, addDays } from '../public/data.js';
import * as dataHelpers from '../public/data.js';

const agent = (name = 'codex', changes = {}) => ({
  agent: name, inputTokens: 10, outputTokens: 20, cacheCreationTokens: 30,
  cacheReadTokens: 40, totalTokens: 100, totalCost: 1.25, modelsUsed: ['example-model'], ...changes,
});
const day = (date, agents = [agent()]) => ({ period: date, agent: 'all', agents, ...sumMetrics(agents) });

describe('ccusage boundary', () => {
  test('sorts daily records, retains reported totals, and strips unrelated metadata', () => {
    const report = normalizeReport({ daily: [day('2026-03-10'), { ...day('2026-03-08'), metadata: { secret: 'not-for-browser' } }] });
    expect(report.daily.map(d => d.date)).toEqual(['2026-03-08', '2026-03-10']);
    expect(report.daily[0].metadata).toBeUndefined();
    expect(report.daily[0].totalTokens).toBe(100);
  });
  test('rejects malformed dates, duplicate dates, missing agents, and non-finite values', () => {
    for (const daily of [[day('2026-02-30')], [day('2026-03-08'), day('2026-03-08')], [{ ...day('2026-03-08'), agents: undefined }], [day('2026-03-08', [agent('codex', { totalTokens: Infinity })])]]) {
      expect(() => normalizeReport({ daily })).toThrow();
    }
  });
  test('rejects agent totals that would distort the stacked chart', () => {
    expect(() => normalizeReport({ daily: [{ ...day('2026-03-08'), totalTokens: 105 }] })).toThrow('totals do not match');
  });
  test('does not silently turn unknown cost into free usage', () => {
    const row = day('2026-03-08', [agent('codex', { totalCost: undefined })]);
    delete row.totalCost;
    const report = normalizeReport({ daily: [row], totals: { unpricedModels: ['example-model'] } });
    expect(report.daily[0].totalCost).toBeNull();
    expect(report.daily[0].agents[0].totalCost).toBeNull();
    expect(report.unpricedModels).toEqual(['example-model']);
  });
});

describe('calendar and aggregation', () => {
  const report = normalizeReport({ daily: [day('2026-03-08', [agent(), agent('hermes')]), day('2026-03-10')] });
  test('keeps gaps explicit across daylight saving time without dropping a date', () => {
    const days = selectDays(report.daily, { from: '2026-03-08', to: '2026-03-10' });
    expect(days.map(d => [d.date, d.recorded])).toEqual([['2026-03-08', true], ['2026-03-09', false], ['2026-03-10', true]]);
    expect(sumMetrics(days).totalTokens).toBe(300);
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
  });
  test('agent filter changes totals and keeps the calendar window', () => {
    const days = selectDays(report.daily, { from: '2026-03-08', to: '2026-03-10', agent: 'hermes' });
    expect(days).toHaveLength(3);
    expect(days.filter(d => d.recorded)).toHaveLength(1);
    expect(sumMetrics(days).totalCost).toBe(1.25);
  });
  test('Monday-based weeks conserve totals and retain partial window boundaries', () => {
    const days = selectDays(report.daily, { from: '2026-03-08', to: '2026-03-10' });
    const weeks = groupDays(days, 'weekly');
    expect(weeks.map(w => [w.date, w.end])).toEqual([['2026-03-08', '2026-03-08'], ['2026-03-09', '2026-03-10']]);
    expect(sumMetrics(weeks)).toEqual(sumMetrics(days));
    expect(agentTotals(weeks)).toEqual(agentTotals(days));
  });
  test('cache share excludes output and remains undefined for no inputs', () => {
    expect(cacheShare(agent())).toBe(.5);
    expect(cacheShare(agent('codex', { inputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }))).toBeNull();
  });
  test('unknown cost propagates through weeks and agent aggregates', () => {
    const days = selectDays(normalizeReport({ daily: [day('2026-03-10', [agent('codex', { totalCost: undefined })])] }).daily, { from: '2026-03-09', to: '2026-03-15' });
    expect(groupDays(days, 'weekly')[0].totalCost).toBeNull();
    expect(agentTotals(days)[0].totalCost).toBeNull();
  });
  test('handles empty and reversed windows', () => {
    expect(normalizeReport({ daily: [] }).daily).toEqual([]);
    expect(selectDays([], { from: '2026-03-10', to: '2026-03-08' })).toEqual([]);
  });
});

describe('comparison facts', () => {
  const completeDaily = () => normalizeReport({
    daily: Array.from({ length: 60 }, (_, index) => day(
      addDays('2026-01-30', index),
      [agent('codex', index < 30 ? {} : { totalTokens: 200, outputTokens: 120 })],
    )),
  }).daily;

  test('compares complete adjacent 30-day recorded windows', () => {
    const daily = completeDaily();
    expect(dataHelpers.comparisonFacts).toBeFunction();
    const facts = dataHelpers.comparisonFacts(daily, { range: '30', agent: 'all' });
    expect(facts.status).toBe('comparable');
    expect(facts.current).toEqual({
      from: '2026-03-01', to: '2026-03-30', calendarDays: 30,
      recordedDays: 30, recordedTokens: 6000,
    });
    expect(facts.previous).toEqual({
      from: '2026-01-30', to: '2026-02-28', calendarDays: 30,
      recordedDays: 30, recordedTokens: 3000,
    });
    expect(facts.delta).toEqual({ tokens: 3000, ratio: 1 });
    expect(facts.caveats).toEqual(['latest-day-may-be-incomplete']);
  });

  test.each([
    ['current', '2026-03-15'],
    ['previous', '2026-02-15'],
  ])('suppresses comparison for an interior %s gap', (which, missing) => {
    const daily = completeDaily().filter(day => day.date !== missing);
    const facts = dataHelpers.comparisonFacts(daily, { range: '30' });
    expect(facts.status).toBe('insufficient-data');
    expect(facts.delta).toBeNull();
    expect(facts[which].calendarDays).toBe(30);
    expect(facts[which].recordedDays).toBe(29);
    expect(facts[which].recordedTokens).toBe(29 * (which === 'current' ? 200 : 100));
    expect(facts.caveats).toEqual([`${which}-gaps`, 'latest-day-may-be-incomplete']);
  });

  test('does not report zero usage for an unobserved selected agent', () => {
    const facts = dataHelpers.comparisonFacts(completeDaily(), { range: '30', agent: 'unknown' });
    expect(facts.agent).toBe('unknown');
    expect(facts.current.recordedDays).toBe(0);
    expect(facts.current.recordedTokens).toBeNull();
    expect(facts.previous.recordedTokens).toBeNull();
    expect(facts.status).toBe('insufficient-data');
    expect(facts.delta).toBeNull();
    expect(facts.caveats).toEqual([
      'no-current-records', 'current-gaps', 'previous-gaps', 'latest-day-may-be-incomplete',
    ]);
  });

  test('clips short current history without shortening its nominal baseline', () => {
    const daily = completeDaily().slice(-10);
    const facts = dataHelpers.comparisonFacts(daily, { range: '30' });
    expect(facts.current.from).toBe(daily[0].date);
    expect(facts.current.calendarDays).toBe(10);
    expect(facts.current.recordedDays).toBe(10);
    expect(facts.current.recordedTokens).toBe(10 * 200);
    expect(facts.previous).toEqual({
      from: '2026-01-30', to: '2026-02-28', calendarDays: 30,
      recordedDays: 0, recordedTokens: null,
    });
    expect(facts.status).toBe('insufficient-data');
    expect(facts.delta).toBeNull();
    expect(facts.caveats).toEqual(['partial-current-window', 'previous-gaps', 'latest-day-may-be-incomplete']);
  });

  test.each([0, 200])('keeps an explicit zero baseline without a percentage for current %i', currentTokens => {
    const daily = normalizeReport({ daily: completeDaily().map((row, index) => {
      const tokens = index < 30 ? 0 : currentTokens;
      return day(row.date, [agent('codex', {
        inputTokens: 0, outputTokens: tokens, cacheCreationTokens: 0,
        cacheReadTokens: 0, totalTokens: tokens, totalCost: 0,
      })]);
    }) }).daily;
    const facts = dataHelpers.comparisonFacts(daily, { range: '30' });
    expect(facts.status).toBe('comparable');
    expect(facts.previous.recordedDays).toBe(30);
    expect(facts.previous.recordedTokens).toBe(0);
    expect(facts.delta).toEqual({ tokens: 30 * currentTokens, ratio: null });
    expect(facts.caveats).toEqual(['zero-baseline', 'latest-day-may-be-incomplete']);
  });

  test('returns an empty-report state instead of inventing a date anchor', () => {
    expect(dataHelpers.comparisonFacts([])).toEqual({
      status: 'empty-report', range: '90', agent: 'all',
      current: null, previous: null, delta: null, caveats: [],
    });
  });

  test.each([
    ['complete agent history', 'codex', false, 'all-history'],
    ['gapped agent history', 'codex', true, 'all-history'],
    ['unknown agent', 'unknown', false, 'insufficient-data'],
  ])('summarizes %s without a baseline', (_label, selected, gap, status) => {
    const daily = completeDaily().filter(row => !gap || row.date !== '2026-02-15');
    const facts = dataHelpers.comparisonFacts(daily, { range: 'all', agent: selected });
    expect(facts.status).toBe(status);
    expect(facts.current).toEqual({
      from: '2026-01-30', to: '2026-03-30', calendarDays: 60,
      recordedDays: selected === 'unknown' ? 0 : gap ? 59 : 60,
      recordedTokens: selected === 'unknown' ? null : 30 * 100 + 30 * 200 - (gap ? 100 : 0),
    });
    expect(facts.previous).toBeNull();
    expect(facts.delta).toBeNull();
    expect(facts.caveats).toEqual([
      ...(selected === 'unknown' ? ['no-current-records', 'current-gaps'] : gap ? ['current-gaps'] : []),
      'latest-day-may-be-incomplete',
    ]);
  });

  test('rejects invalid selections even when the report is empty', () => {
    for (const daily of [[], completeDaily()]) {
      for (const range of ['7', '030', '', 30, 90, null, {}, NaN]) {
        expect(() => dataHelpers.comparisonFacts(daily, { range })).toThrow(RangeError);
      }
      for (const selected of ['', 0, null, {}, ['codex']]) {
        expect(() => dataHelpers.comparisonFacts(daily, { agent: selected })).toThrow(TypeError);
      }
    }
  });

  test.each([15, 30])('does not invent an out-of-domain baseline for %i earliest supported days', count => {
    const daily = normalizeReport({ daily: Array.from({ length: count }, (_, index) =>
      day(addDays('1900-01-01', index))) }).daily;
    const facts = dataHelpers.comparisonFacts(daily, { range: '30' });
    expect(facts.previous).toBeNull();
    expect(facts.current.calendarDays).toBe(count);
    expect(facts.current.recordedTokens).toBe(count * 100);
    expect(facts.status).toBe('insufficient-data');
    expect(facts.delta).toBeNull();
    expect(facts.caveats).toEqual([
      ...(count < 30 ? ['partial-current-window'] : []),
      'previous-out-of-range', 'latest-day-may-be-incomplete',
    ]);
  });

  test.each(['current', 'previous', 'both', 'all-history'])('does not report imprecise %s totals', which => {
    const positions = which === 'current' ? [30] : which === 'previous' ? [0] : [0, 30];
    const daily = normalizeReport({ daily: completeDaily().map((row, index) =>
      day(row.date, [agent('codex', { totalTokens: positions.includes(index) ? Number.MAX_SAFE_INTEGER : row.totalTokens })])) }).daily;
    const facts = dataHelpers.comparisonFacts(daily, { range: which === 'all-history' ? 'all' : '30' });
    if (which !== 'previous') expect(facts.current.recordedTokens).toBeNull();
    if (which === 'previous' || which === 'both') expect(facts.previous.recordedTokens).toBeNull();
    expect(facts.status).toBe(which === 'all-history' ? 'all-history' : 'insufficient-data');
    expect(facts.delta).toBeNull();
    expect(facts.caveats).toEqual(['unsafe-total', 'latest-day-may-be-incomplete']);
  });

  test.each([
    ['leap year', '2024-01-31', 60, '2024-03-01', '2024-03-30', '2024-02-29'],
    ['90-day year boundary', '2025-10-02', 180, '2025-12-31', '2026-03-30', '2025-12-30'],
    ['upper calendar limit', '2100-11-02', 60, '2100-12-02', '2100-12-31', '2100-12-01'],
    ['first complete baseline', '1900-01-01', 60, '1900-01-31', '1900-03-01', '1900-01-30'],
    ['fall daylight saving', '2026-10-01', 60, '2026-10-31', '2026-11-29', '2026-10-30'],
  ])('keeps exact calendar windows across %s', (_label, first, count, from, to, previousTo) => {
    const daily = normalizeReport({ daily: Array.from({ length: count }, (_, index) =>
      day(addDays(first, index))) }).daily;
    const facts = count === 180 ? dataHelpers.comparisonFacts(daily)
      : dataHelpers.comparisonFacts(daily, { range: '30' });
    expect(facts.range).toBe(String(count / 2));
    expect(facts.agent).toBe('all');
    expect(facts.status).toBe('comparable');
    expect(facts.current).toEqual({ from, to, calendarDays: count / 2, recordedDays: count / 2, recordedTokens: count / 2 * 100 });
    expect(facts.previous.from).toBe(first);
    expect(facts.previous.to).toBe(previousTo);
    expect(facts.previous.calendarDays).toBe(count / 2);
    expect(facts.delta).toEqual({ tokens: 0, ratio: 0 });
  });

  test('filters agent totals without moving the full report anchor', () => {
    const daily = normalizeReport({ daily: completeDaily().map((row, index) =>
      day(row.date, [agent('codex', { totalTokens: row.totalTokens }), agent('hermes', { totalTokens: index < 30 ? 10 : 20 })])) }).daily;
    const facts = dataHelpers.comparisonFacts(daily, { range: '30', agent: 'hermes' });
    expect(facts.status).toBe('comparable');
    expect(facts.current.from).toBe('2026-03-01');
    expect(facts.current.to).toBe('2026-03-30');
    expect(facts.current.recordedTokens).toBe(30 * 20);
    expect(facts.previous.recordedTokens).toBe(30 * 10);
    expect(facts.delta).toEqual({ tokens: 30 * 10, ratio: 1 });
    expect(dataHelpers.comparisonFacts(daily, { range: '30' }).current.recordedTokens).toBe(30 * (200 + 20));
  });

  test.each([
    ['latest selected-agent day', 59, 'current-gaps'],
    ['previous selected-agent day', 10, 'previous-gaps'],
  ])('treats a missing %s as unknown rather than zero', (_label, missing, caveat) => {
    const daily = normalizeReport({ daily: completeDaily().map((row, index) =>
      day(row.date, [agent('codex'), ...(index === missing ? [] : [agent('hermes')])])) }).daily;
    const facts = dataHelpers.comparisonFacts(daily, { range: '30', agent: 'hermes' });
    expect(facts.current.to).toBe('2026-03-30');
    expect(facts.status).toBe('insufficient-data');
    expect(facts.delta).toBeNull();
    expect(facts.caveats).toEqual([caveat, 'latest-day-may-be-incomplete']);
    expect(dataHelpers.comparisonFacts(daily, { range: '30' }).status).toBe('comparable');
  });

  test('does not infer a complete loss of activity when an agent has no current records', () => {
    const daily = normalizeReport({ daily: completeDaily().map((row, index) =>
      day(row.date, [agent(index < 30 ? 'hermes' : 'codex')])) }).daily;
    const facts = dataHelpers.comparisonFacts(daily, { range: '30', agent: 'hermes' });
    expect(facts.current.recordedTokens).toBeNull();
    expect(facts.previous.recordedTokens).toBe(30 * 100);
    expect(facts.delta).toBeNull();
    expect(facts.caveats).toEqual(['no-current-records', 'current-gaps', 'latest-day-may-be-incomplete']);
  });

  test('does not treat an empty agent array as an explicit zero observation', () => {
    const daily = normalizeReport({ daily: completeDaily().map(row =>
      day(row.date, row.date === '2026-03-15' ? [] : row.agents)) }).daily;
    const facts = dataHelpers.comparisonFacts(daily, { range: '30' });
    expect(facts.current.recordedDays).toBe(29);
    expect(facts.current.recordedTokens).toBe(29 * 200);
    expect(facts.delta).toBeNull();
    expect(facts.caveats).toEqual(['current-gaps', 'latest-day-may-be-incomplete']);
  });

  test.each([0, 50, 100])('preserves signed change when current daily tokens are %i', tokens => {
    const daily = normalizeReport({ daily: completeDaily().map((row, index) =>
      day(row.date, [agent('codex', { totalTokens: index < 30 ? 100 : tokens })])) }).daily;
    const facts = dataHelpers.comparisonFacts(daily, { range: '30' });
    expect(facts.status).toBe('comparable');
    expect(facts.delta).toEqual({ tokens: (tokens - 100) * 30, ratio: (tokens - 100) / 100 });
  });

  test('compares headline tokens independently of token categories and unknown costs', () => {
    const daily = normalizeReport({ daily: completeDaily().map((row, index) =>
      day(row.date, [agent('codex', { totalTokens: index < 30 ? 10 : 30, totalCost: null })])) }).daily;
    const facts = dataHelpers.comparisonFacts(daily, { range: '30' });
    expect(facts.status).toBe('comparable');
    expect(facts.current.recordedTokens).toBe(30 * 30);
    expect(facts.previous.recordedTokens).toBe(30 * 10);
    expect(facts.delta).toEqual({ tokens: 30 * 20, ratio: 2 });
  });

  test('accepts the exact safe-integer total without rounding or flagging it unsafe', () => {
    const daily = normalizeReport({ daily: completeDaily().map((row, index) =>
      day(row.date, [agent('codex', { totalTokens: index === 30 ? Number.MAX_SAFE_INTEGER : 0 })])) }).daily;
    const facts = dataHelpers.comparisonFacts(daily, { range: '30' });
    expect(facts.status).toBe('comparable');
    expect(facts.current.recordedTokens).toBe(Number.MAX_SAFE_INTEGER);
    expect(facts.delta).toEqual({ tokens: Number.MAX_SAFE_INTEGER, ratio: null });
    expect(facts.caveats).toEqual(['zero-baseline', 'latest-day-may-be-incomplete']);
  });

  test('keeps simultaneous caveats ordered and does not call absent data unsafe', () => {
    const daily = normalizeReport({ daily: [day('1900-01-15')] }).daily;
    const facts = dataHelpers.comparisonFacts(daily, { range: '30', agent: 'unknown' });
    expect(facts.caveats).toEqual([
      'partial-current-window', 'no-current-records', 'current-gaps',
      'previous-out-of-range', 'latest-day-may-be-incomplete',
    ]);
  });

  test('does not mutate deeply frozen normalized records or options', () => {
    const daily = completeDaily();
    const original = JSON.stringify(daily);
    for (const row of daily) {
      for (const agent of row.agents) { Object.freeze(agent.modelsUsed); Object.freeze(agent); }
      Object.freeze(row.agents); Object.freeze(row);
    }
    Object.freeze(daily);
    for (const range of ['30', '90', 'all']) {
      const options = Object.freeze({ range, agent: 'codex' });
      const result = dataHelpers.comparisonFacts(daily, options);
      expect(JSON.parse(JSON.stringify(result))).toEqual(result);
      expect(options).toEqual({ range, agent: 'codex' });
    }
    expect(JSON.stringify(daily)).toBe(original);
  });
});
