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

// Present comparisonFacts results as text; the renderer owns HTML escaping.
export function overviewStory(facts, { agentLabel, source }) {
  const { current, previous, delta, caveats } = facts;
  const footer = source === 'example' ? 'SYNTHETIC EXAMPLE · NOT REAL USAGE'
    : source === 'pasted' ? 'USER-SUPPLIED REPORT'
    : source === 'local' ? 'LOCAL SNAPSHOT · AVAILABLE RECORDS ONLY' : 'AVAILABLE REPORT ONLY';
  if (!current) return {
    sentences: [`No recorded observations are available for ${agentLabel}.`, 'Try a different agent, a wider window, or another report.'], footer,
  };

  let summary;
  if (!current.recordedDays) summary = `No recorded observations are available for ${agentLabel}`;
  else if (current.recordedTokens === null) summary = `A precise recorded-token total is unavailable for ${agentLabel}`;
  else summary = `${agentLabel} recorded ${number(current.recordedTokens)} tokens`;

  let comparison;
  if (!delta) {
    const reasons = [];
    if (caveats.includes('previous-out-of-range')) reasons.push('the previous window falls outside the supported calendar');
    if (caveats.includes('partial-current-window')) reasons.push(`the current window is partial (${current.calendarDays} of ${facts.range} days available)`);
    if (caveats.includes('current-gaps')) reasons.push('the current window has missing observations');
    if (caveats.includes('previous-gaps')) reasons.push(`the previous window has missing observations ${span(previous)}`);
    if (previous?.recordedDays && previous.recordedTokens === null) reasons.push(`a precise total is unavailable for the previous window ${span(previous)}`);
    comparison = `${facts.range === 'all' ? 'All history has no comparison baseline' : 'No comparison'}${reasons.length ? ': ' + reasons.join('; ') : ''}.`;
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
  return {
    sentences: [
      `${summary} ${span(current)} (${current.recordedDays} of ${current.calendarDays} calendar days observed).`,
      comparison,
      current.recordedDays ? context : `Try a different agent, a wider window, or another report; ${context[0].toLowerCase() + context.slice(1)}`,
    ],
    footer,
  };
}
