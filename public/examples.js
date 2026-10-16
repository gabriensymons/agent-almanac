import { addDays, sumMetrics } from './data.js';

// Deterministic, invented usage. These examples never read anyone's local logs.
const dailyActivity = [
  8, 13, 26, 20, 32,
  24, 48, 61, 39, 52,
  41, 63, 88, 57, 71,
  21, 14, 32, 26, 40,
  52, 79, 64, 95, 72,
  61, 48, 74, 105, 86,
  55, 84, 67, 98, 112,
  76, 58, 89, 101, 84,
  63, 87, 108, 93,
];
const weeklyAgentMix = [[6, 3, 1], [5, 3, 2], [4, 4, 2], [2, 6, 2], [3, 4, 3], [3, 5, 2], [2, 3, 5], [4, 3, 3], [2, 4, 4]];

function makeExample(kind) {
  const daily = [];
  const agentNames = kind === 'solo' ? ['codex'] : ['codex', 'claude', 'hermes'];
  for (let i = 0; i < 60; i++) {
    const date = addDays('2026-08-03', i);
    if (new Date(date).getUTCDay() % 6 === 0) continue;
    const day = daily.length;
    const agents = agentNames.map((agent, j) => {
      const scale = kind === 'solo' ? dailyActivity[day] : Math.round(dailyActivity[day] * weeklyAgentMix[Math.floor(i / 7)][j] / 10);
      const inputTokens = scale * (kind === 'cache' ? 180 : [1100, 2200, 3600, 1800, 900][day % 5]);
      const outputTokens = scale * [650, 900, 1800, 1200, 500][(day + j) % 5];
      const cacheCreationTokens = scale * [1800, 3200, 5200, 2600, 1000][(day + j * 2) % 5];
      const cacheReadTokens = scale * (kind === 'cache' ? 180000 : [12000, 27000, 42000, 16000, 8000][(day + j) % 5]) * (j === 0 ? 2 : 1);
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
