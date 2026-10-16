import { addDays, sumMetrics } from './data.js';

// Deterministic, invented usage. These examples never read anyone's local logs.
function makeExample(kind) {
  const daily = [];
  for (let i = 0; i < 60; i++) {
    const date = addDays('2026-08-03', i);
    if (new Date(date).getUTCDay() % 6 === 0) continue;
    const agentNames = kind === 'solo' ? ['codex'] : ['codex', 'claude', 'hermes'];
    const agents = agentNames.map((agent, j) => {
      const scale = (8 + (i * 7 + j * 11) % 20) * (i === 31 ? 4 : 1);
      const inputTokens = scale * (kind === 'cache' ? 180 : 1400);
      const outputTokens = scale * 750;
      const cacheCreationTokens = scale * 3200;
      const cacheReadTokens = scale * (kind === 'cache' ? 180000 : 27000) * (j === 0 ? 2 : 1);
      const totalTokens = inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens;
      const totalCost = kind === 'unpriced' ? 0 : Number(((inputTokens * 3 + outputTokens * 15 + cacheCreationTokens * 3.75 + cacheReadTokens * .3) / 1000000).toFixed(6));
      return { agent, inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, totalTokens, totalCost, modelsUsed: [kind === 'unpriced' ? 'example-unpriced-model' : `example-${agent}-model`] };
    });
    daily.push({ period: date, agent: 'all', ...sumMetrics(agents), agents });
  }
  return { daily, totals: { ...sumMetrics(daily), ...(kind === 'unpriced' ? { unpricedModels: ['example-unpriced-model'] } : {}) } };
}

export const examples = [
  { id: 'mixed', label: 'Three agents · mixed usage', report: makeExample('mixed') },
  { id: 'solo', label: 'One agent · weekday rhythm', report: makeExample('solo') },
  { id: 'cache', label: 'Cache-heavy · repeated context', report: makeExample('cache') },
  { id: 'unpriced', label: 'Unknown prices · cost caveat', report: makeExample('unpriced') },
  { id: 'empty', label: 'Empty report · getting started', report: { daily: [], totals: sumMetrics([]) } },
];
