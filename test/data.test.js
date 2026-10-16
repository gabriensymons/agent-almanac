import { describe, test, expect } from 'bun:test';
import { normalizeReport, selectDays, groupDays, sumMetrics, agentTotals, cacheShare, addDays } from '../public/data.js';

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
