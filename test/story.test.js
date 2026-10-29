import { expect, test } from 'bun:test';
import * as story from '../public/story.js';
import { comparisonFacts, normalizeReport } from '../public/data.js';

function history({ before = 100, after = 200, count = 60, start = '2026-01-30' } = {}) {
  return normalizeReport({ daily: Array.from({ length: count }, (_, i) => {
    const date = new Date(start + 'T00:00:00Z');
    date.setUTCDate(date.getUTCDate() + i);
    const tokens = i < count / 2 ? before : after;
    const metrics = { inputTokens: tokens, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: tokens, totalCost: null };
    return { date: date.toISOString().slice(0, 10), ...metrics, agents: [{ agent: 'synthetic', modelsUsed: [], ...metrics }] };
  }) }).daily;
}
const options = { agentLabel: 'All agents', source: 'pasted' };
const facts = (daily = history(), selection = {}) => comparisonFacts(daily, { range: '30', ...selection });
const text = value => value.sentences.join(' ');

test.each([
  [2000, 2009, '0.5% more'], [2000, 1991, '0.5% fewer'],
  [2000, 2011, '0.6% more'], [2000, 1989, '0.6% fewer'],
  [2000, 2037, '1.9% more'], [2000, 1963, '1.9% fewer'],
  [1000, Number.MAX_SAFE_INTEGER, '900,719,925,473,999.1% more'],
])('rounds the exact recorded change from %d to %d', (previous, current, expected) => {
  const daily = history({ before: 0, after: 0 });
  for (const [index, tokens] of [[0, previous], [30, current]]) {
    for (const row of [daily[index], daily[index].agents[0]]) row.inputTokens = row.totalTokens = tokens;
  }
  const f = facts(normalizeReport({ daily }).daily);
  expect(f.status).toBe('comparable');
  expect(text(story.overviewStory(f, options))).toContain(expected);
});

test('preserves combined coverage and precision limitations without mutating facts', () => {
  const daily = history({ before: Number.MAX_SAFE_INTEGER, after: Number.MAX_SAFE_INTEGER }).filter(day => day.date !== '2026-03-15' && day.date !== '2026-02-15');
  const f = facts(daily);
  const before = JSON.stringify(f);
  for (const item of [f.current, f.previous, f.caveats, f]) Object.freeze(item);
  const result = text(story.overviewStory(f, Object.freeze({ ...options, agentLabel: '<b>literal & label</b>' })));
  expect(result).toContain('<b>literal & label</b>');
  expect(result).toContain('29 of 30 calendar days observed');
  expect(result).toContain('current window has missing observations');
  expect(result).toContain('previous window has missing observations');
  expect(result).toContain('precise total is unavailable for the previous window');
  expect(result).not.toMatch(/%|NaN|Infinity/);
  expect(JSON.stringify(f)).toBe(before);
});

test.each(['2024-01-01', '2026-10-01', '2099-11-01'])('uses explicit calendar years for a complete 90-day comparison starting %s', start => {
  const f = facts(history({ start, count: 180 }), { range: '90' });
  const result = story.overviewStory(f, options);
  expect(result.sentences).toHaveLength(3);
  expect(text(result)).toContain('90 of 90 calendar days observed');
  expect(text(result)).toContain('100% more');
  expect(text(result)).toContain(f.current.to.slice(0, 4));
  expect(text(result)).toContain(f.previous.from.slice(0, 4));
});

test.each([['example', 'SYNTHETIC EXAMPLE · NOT REAL USAGE'], ['local', 'LOCAL SNAPSHOT · AVAILABLE RECORDS ONLY'], ['pasted', 'USER-SUPPLIED REPORT'], ['unknown', 'AVAILABLE REPORT ONLY']])('identifies source %s without exporting raw metadata', (source, footer) => {
  for (const f of [facts(), facts([])]) expect(story.overviewStory(f, { ...options, source }).footer).toBe(footer);
});

test('uses an exact token difference when the percentage display would be unsafe', () => {
  const f = facts();
  f.current.recordedTokens = Number.MAX_SAFE_INTEGER;
  f.previous.recordedTokens = 1;
  f.delta = { tokens: Number.MAX_SAFE_INTEGER - 1, ratio: Number.MAX_SAFE_INTEGER - 1 };
  const result = text(story.overviewStory(f, options));
  expect(result).toContain('9,007,199,254,740,990 more recorded tokens than');
  expect(result).not.toMatch(/%|NaN|Infinity/);
});

test.each([[100001, 'less than 0.1% more'], [99999, 'less than 0.1% fewer'], [100123, '0.1% more']])('formats a small signed change without erasing it (%s)', (after, phrase) => {
  const result = text(story.overviewStory(facts(history({ before: 100000, after })), options));
  expect(result).toContain(phrase);
  expect(result).not.toContain('unchanged');
});

test('explains an unavailable calendar baseline rather than inventing it', () => {
  const result = text(story.overviewStory(facts(history({ start: '1900-01-01', count: 30 })), options));
  expect(result).toContain('previous window falls outside the supported calendar');
  expect(result).not.toMatch(/1899|%/);
});

test.each(['current', 'previous', 'both', 'all'])('explains unavailable precise totals: %s', side => {
  const daily = history({ before: side === 'previous' || side === 'both' ? Number.MAX_SAFE_INTEGER : 100, after: side !== 'previous' ? Number.MAX_SAFE_INTEGER : 200 });
  const result = text(story.overviewStory(facts(daily, { range: side === 'all' ? 'all' : '30' }), options));
  expect(result).toContain('precise');
  if (side !== 'previous') expect(result).toContain('A precise recorded-token total is unavailable for All agents');
  if (side === 'previous' || side === 'both') expect(result).toContain('a precise total is unavailable for the previous window');
  expect(result).not.toMatch(/recorded 0 tokens|NaN|Infinity|%/);
});

test.each(['30', 'all'])('absent selected-agent observations are not zero in range %s', range => {
  const daily = history().map((day, i) => i < 30 ? day : { ...day, agents: day.agents.map(a => ({ ...a, agent: 'other' })) });
  const result = text(story.overviewStory(facts(daily, { range, agent: range === 'all' ? 'missing' : 'synthetic' }), { ...options, agentLabel: 'Selected agent' }));
  expect(result).toContain('No recorded observations are available for Selected agent');
  expect(result).toContain(range === 'all' ? '0 of 60 calendar days observed' : '0 of 30 calendar days observed');
  expect(result).toContain('Try a different agent');
  expect(result).toContain('Mar 30, 2026');
  expect(result).not.toMatch(/recorded 0 tokens|100% fewer|NaN/);
});

test('an empty report has no dates, invented zero, or latest-day assertion', () => {
  const result = story.overviewStory(facts([]), options);
  expect(result.sentences).toEqual(['No recorded observations are available for All agents.', 'Try a different agent, a wider window, or another report.']);
  expect(text(result)).not.toMatch(/0 tokens|incomplete|%/);
});

test.each([false, true])('all-history has no invented baseline (gap %s)', gap => {
  const daily = history().filter(day => !gap || day.date !== '2026-02-15');
  const result = text(story.overviewStory(facts(daily, { range: 'all' }), options));
  expect(result).toContain('All history has no comparison baseline');
  expect(result).toContain(gap ? '59 of 60 calendar days observed' : '60 of 60 calendar days observed');
  if (gap) expect(result).toContain('current window has missing observations');
  expect(result).not.toContain('previous window');
  expect(result).not.toContain('%');
});

test('distinguishes a clipped partial current window from an interior gap', () => {
  const result = text(story.overviewStory(facts(history().slice(-15)), options));
  expect(result).toContain('15 of 15 calendar days observed');
  expect(result).toContain('current window is partial (15 of 30 days available)');
  expect(result).toContain('previous window has missing observations');
  expect(result).not.toContain('current window has missing');
  expect(result).not.toContain('%');
});

test('identifies a previous gap without claiming the current window is incomplete', () => {
  const result = text(story.overviewStory(facts(history().filter(day => day.date !== '2026-02-15')), options));
  expect(result).toContain('previous window has missing observations from Jan 30, 2026 to Feb 28, 2026');
  expect(result).not.toContain('current window has missing');
  expect(result).not.toContain('%');
});

test('suppresses a comparison for an interior current gap', () => {
  const daily = history().filter(day => day.date !== '2026-03-15');
  const result = text(story.overviewStory(facts(daily), options));
  expect(result).toContain('5,800 tokens');
  expect(result).toContain('29 of 30 calendar days observed');
  expect(result).toContain('current window has missing observations');
  expect(result).not.toContain('%');
});

test.each([0, 200])('never invents a percentage from a zero baseline (%s current)', after => {
  const result = text(story.overviewStory(facts(history({ before: 0, after })), options));
  expect(result).toContain('previous window explicitly records 0 tokens from Jan 30, 2026 to Feb 28, 2026');
  expect(result).toContain('percentage change is undefined');
  expect(result).not.toContain('%');
});

test.each([[50, '50% fewer'], [100, 'unchanged from'], [0, '100% fewer']])('preserves the signed change for %s daily current tokens', (after, phrase) => {
  const result = text(story.overviewStory(facts(history({ after })), options));
  expect(result).toContain(phrase);
  expect(result).not.toContain('-%');
});

test('explains a fully observed increase with both calendar windows', () => {
  expect(story.overviewStory).toBeFunction();
  expect(story.overviewStory(facts(), options)).toEqual({
    sentences: [
      'All agents recorded 6,000 tokens from Mar 1, 2026 to Mar 30, 2026 (30 of 30 calendar days observed).',
      'That is 100% more than the 3,000 recorded tokens from Jan 30, 2026 to Feb 28, 2026.',
      'The latest report day may be incomplete; token volume does not measure productivity or quality.',
    ],
    footer: 'USER-SUPPLIED REPORT',
  });
});
