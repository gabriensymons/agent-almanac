import { test, expect } from 'bun:test';
import { parseUsage } from '../public/import.js';
import { examples } from '../public/examples.js';
import { sumMetrics } from '../public/data.js';

const table = `Coding (Agent) CLI Usage Report - Daily
│ Date       │ Agent    │ Models      │ Input │ Output │ Cache Create │ Cache Read │ Total Tokens │ Cost (USD) │
│ 2026-08-03 │ All      │             │ 20    │ 40     │ 60           │ 80         │ 200          │ $0.03      │
│            │ - Codex  │ - example-a │ 10    │ 20     │ 30           │ 40         │ 100          │ $0.01      │
│            │          │ - example-b │       │        │              │            │              │            │
│            │ - Hermes │ - example-c │ 10    │ 20     │ 30           │ 40         │ 100          │ $0.01      │
│ Total      │          │             │ 20    │ 40     │ 60           │ 80         │ 200          │ $0.03      │`;

test('all examples are deterministic valid reports with matching totals', () => {
  for (const example of examples) {
    const parsed = parseUsage(JSON.stringify(example.report));
    expect(sumMetrics(parsed.daily).totalTokens).toBe(example.report.totals.totalTokens);
    expect(parsed.daily.every(day => day.agents.every(a => a.modelsUsed.every(m => m.startsWith('example-'))))).toBe(true);
  }
});

test('imports a wide terminal table with ANSI codes, continued models, and rounded costs', () => {
  const parsed = parseUsage('\x1b[32m' + table + '\x1b[0m');
  expect(parsed.daily[0].totalTokens).toBe(200);
  expect(parsed.daily[0].totalCost).toBe(.03);
  expect(parsed.daily[0].agents[0].modelsUsed).toEqual(['example-a', 'example-b']);
  expect(parsed.warnings[0]).toContain('rounded');
});

test('rejects incomplete, inconsistent, compact, and non-daily tables', () => {
  for (const text of [table.replace(/│ Total.*$/, ''), table.replace('200', '201'), table.replace('100', '0.1K'), table.replace('Date', 'Month')]) {
    expect(() => parseUsage(text)).toThrow();
  }
});

test('imports legacy daily JSON as combined data without inventing agents', () => {
  const original = examples[0].report.daily[0];
  const { agents, ...day } = original;
  const parsed = parseUsage(JSON.stringify({ daily: [{ ...day, period: undefined, date: original.period }] }));
  expect(parsed.daily[0].agents[0].agent).toBe('combined');
  expect(parsed.daily[0].totalTokens).toBe(original.totalTokens);
  expect(parsed.warnings[0]).toContain('no agent breakdown');
});

test('keeps unknown costs and unpriced-model warnings distinct from free usage', () => {
  const raw = structuredClone(examples[1].report);
  delete raw.daily[0].totalCost;
  delete raw.daily[0].agents[0].totalCost;
  expect(parseUsage(JSON.stringify(raw)).daily[0].totalCost).toBeNull();
  expect(parseUsage(JSON.stringify(examples[3].report)).unpricedModels).toEqual(['example-unpriced-model']);
});

test('validates untrusted paste input and drops unrelated private metadata', () => {
  for (const text of ['', '{broken', '{"daily":[null]}', '{"session":[]}', 'x'.repeat(2 * 1024 * 1024 + 1)]) expect(() => parseUsage(text)).toThrow();
  const raw = structuredClone(examples[1].report);
  raw.daily[0].prompt = 'PRIVATE_PROMPT';
  raw.daily[0].agents[0].projectPath = 'PRIVATE_PATH';
  expect(JSON.stringify(parseUsage(JSON.stringify(raw)))).not.toContain('PRIVATE_');
  raw.daily[0].agents[0].inputTokens = 1.5;
  expect(() => parseUsage(JSON.stringify(raw))).toThrow();
});

test('rejects excessive agent counts and invalid agent records before rendering', () => {
  const raw = structuredClone(examples[0].report);
  raw.daily[0].agents[0] = null;
  expect(() => parseUsage(JSON.stringify(raw))).toThrow('Invalid agent record');
  const many = structuredClone(examples[1].report);
  many.daily.forEach((row, i) => { row.agents[0].agent = `agent-${i}`; });
  expect(() => parseUsage(JSON.stringify(many))).toThrow('32 distinct agents');
});
