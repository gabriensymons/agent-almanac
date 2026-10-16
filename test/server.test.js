import { test, expect } from 'bun:test';
import { handleRequest } from '../server.js';

const url = 'http://127.0.0.1:4318';
test('only serves known assets and refuses cross-origin access', async () => {
  const options = { port: 4318, getSnapshot: () => ({ daily: [] }), reload: () => ({ daily: [] }) };
  for (const request of [new Request('http://attacker.example:4318/api/usage'), new Request(url + '/api/usage', { headers: { origin: 'https://attacker.example' } }), new Request(url + '/api/usage', { headers: { 'sec-fetch-site': 'cross-site' } })]) {
    expect((await handleRequest(request, options)).status).toBe(403);
  }
  expect((await handleRequest(new Request(url + '/.data/usage.json'), options)).status).toBe(404);
  expect((await handleRequest(new Request(url + '/server.js'), options)).status).toBe(404);
  expect((await handleRequest(new Request(url + '/api/usage', { headers: { host: 'attacker.example' } }), options)).status).toBe(403);
  expect((await handleRequest(new Request(url + '/api/usage', { method: 'DELETE' }), options)).status).toBe(405);
});

test('refresh is explicit and the saved snapshot survives a failed refresh', async () => {
  const saved = { daily: [], updatedAt: '2026-03-10T00:00:00Z' };
  let refreshes = 0;
  const options = { port: 4318, getSnapshot: () => saved, reload: () => { refreshes++; throw new Error('Synthetic test failure'); } };
  expect(await (await handleRequest(new Request(url + '/api/usage'), options)).json()).toEqual(saved);
  expect(refreshes).toBe(0);
  const failed = await handleRequest(new Request(url + '/api/usage', { method: 'POST' }), options);
  expect(failed.status).toBe(503);
  expect(refreshes).toBe(1);
  expect(await (await handleRequest(new Request(url + '/api/usage'), options)).json()).toEqual(saved);
});
