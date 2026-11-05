const number = value => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
function percent(tokens, baseline) {
  // Quantize the exact recorded change, not a separately scaled floating ratio.
  const scaled = BigInt(Math.abs(tokens)) * 1000n;
  const denominator = BigInt(baseline);
  if (scaled < denominator) return 'less than 0.1';
  const tenths = (2n * scaled + denominator) / (2n * denominator);
  if (tenths > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  // Keep the whole and fractional parts exact even when a Number loses a tenth.
  return number(tenths / 10n) + (tenths % 10n ? '.' + tenths % 10n : '');
}
const date = value => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(value + 'T00:00:00Z'));
const span = period => `from ${date(period.from)} to ${date(period.to)}`;
const context = 'The latest report day may be incomplete; token volume does not measure productivity or quality.';

// Format only eligible observations; data-derived labels stay plain text until rendering.
export function storyHighlights(insights, { nameForAgent = agent => agent } = {}) {
  return insights.map(insight => {
    if (insight.kind === 'weekday') {
      const weekday = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][insight.weekday];
      const count = BigInt(insight.recordedDays);
      const mean = (2n * BigInt(insight.recordedTokens) + count) / (2n * count);
      const average = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(mean);
      const scope = insight.agent === 'all' ? '' : `Looking just at ${nameForAgent(insight.agent)}, `;
      return {
        kind: insight.kind, title: `${weekday}s stand out.`,
        text: `${scope}${weekday}s average about ${average} recorded tokens—the highest day-of-week average in this window.`,
        evidence: `Based on ${insight.recordedDays} recorded ${weekday}s. The latest report day is left out.`,
      };
    }
    if (insight.kind === 'agent-mix') {
      const { prior, recent } = insight;
      const share = period => number((2n * BigInt(period.agentTokens) * 100n + BigInt(period.recordedTokens)) / (2n * BigInt(period.recordedTokens)));
      const agent = nameForAgent(insight.agent);
      return {
        kind: insight.kind, title: `More ${agent} in the mix.`,
        text: `${agent}’s share of all-agent recorded tokens grew from ${share(prior)}% to ${share(recent)}% across two completed four-week periods.`,
        evidence: `${date(prior.from)} – ${date(prior.to)} → ${date(recent.from)} – ${date(recent.to)}. ${prior.recordedDays} recorded days per period, with matching day coverage.`,
      };
    }
    throw new RangeError('Unsupported story insight.');
  });
}

// Keep sentence text alongside structured layout parts; the renderer owns HTML escaping.
export function overviewStory(facts, { agentLabel, source }) {
  const { current, previous, delta, caveats } = facts;
  const footer = source === 'example' ? 'SYNTHETIC EXAMPLE · NOT REAL USAGE'
    : source === 'pasted' ? 'USER-SUPPLIED REPORT'
    : source === 'local' ? 'LOCAL SNAPSHOT · AVAILABLE RECORDS ONLY' : 'AVAILABLE REPORT ONLY';
  if (!current) {
    const summary = `No recorded observations are available for ${agentLabel}.`;
    const guidance = 'Try a different agent, a wider window, or another report.';
    return {
      sentences: [summary, guidance], footer,
      layout: { summary, period: null, comparison: null, context: guidance },
    };
  }

  let summary;
  if (!current.recordedDays) summary = `No recorded observations are available for ${agentLabel}`;
  else if (current.recordedTokens === null) summary = `A precise recorded-token total is unavailable for ${agentLabel}`;
  else summary = `${agentLabel} recorded ${number(current.recordedTokens)} tokens`;

  let comparison, comparisonLabel;
  const reasons = [];
  if (!delta) {
    if (caveats.includes('previous-out-of-range')) reasons.push('the previous window falls outside the supported calendar');
    if (caveats.includes('partial-current-window')) reasons.push(`the current window is partial (${current.calendarDays} of ${facts.range} days available)`);
    if (caveats.includes('current-gaps')) reasons.push('the current window has missing observations');
    if (caveats.includes('previous-gaps')) reasons.push(`the previous window has missing observations ${span(previous)}`);
    if (previous?.recordedDays && previous.recordedTokens === null) reasons.push(`a precise total is unavailable for the previous window ${span(previous)}`);
    comparisonLabel = facts.range === 'all' ? 'All history has no comparison baseline' : 'No comparison';
    comparison = `${comparisonLabel}${reasons.length ? ': ' + reasons.join('; ') : ''}.`;
  } else if (delta.ratio === null) {
    comparison = `The previous window explicitly records 0 tokens ${span(previous)}; percentage change is undefined.`;
  } else {
    // Preserve direction before rounding; oversized displays use the absolute change.
    const percentage = percent(delta.tokens, previous.recordedTokens);
    const magnitude = percentage === null ? number(Math.abs(delta.tokens)) : percentage + '%';
    const change = delta.tokens === 0 ? 'unchanged from'
      : `${magnitude} ${delta.tokens > 0 ? 'more' : 'fewer'}${percentage === null ? ' recorded tokens' : ''} than`;
    comparison = `That is ${change} the ${number(previous.recordedTokens)} recorded tokens ${span(previous)}.`;
  }
  const period = `${span(current)} (${current.recordedDays} of ${current.calendarDays} calendar days observed).`;
  const guidance = current.recordedDays ? context : `Try a different agent, a wider window, or another report; ${context[0].toLowerCase() + context.slice(1)}`;
  return {
    sentences: [
      `${summary} ${period}`,
      comparison,
      guidance,
    ],
    footer,
    layout: {
      summary,
      period,
      comparison: { text: comparisonLabel ? comparisonLabel + '.' : comparison, reasons },
      context: guidance,
    },
  };
}
