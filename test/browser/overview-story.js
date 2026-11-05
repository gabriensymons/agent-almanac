/*
 * Synthetic real-browser checks, separate from `bun test` (no DOM mocks).
 * Start `PORT=0 bun run preview:sandbox` (builds at launch), and open its printed
 * /agent-almanac/ URL in a dedicated browser. If the imported sandbox asset allowlist
 * changes, restart only the task-owned preview and open its newly printed URL.
 * This startup recipe does not replace independently required build verification
 * or existing asset-serving checks.
 * Evaluate this entire async expression in DevTools or CDP Runtime.evaluate with
 * awaitPromise/returnByValue enabled;
 * an exception is failure. No application modules or renderer functions are called.
 * Local-mode smoke checks require a disposable server using the real handleRequest
 * with a synthetic getSnapshot: 60 days starting 2026-01-30, one 'synthetic' agent,
 * 100 input/total tokens daily for 30 days then 200; all other token fields zero,
 * costs null, unpricedModels [], timezone 'UTC'. Never use real usage data.
 * Real keyboard driving, reload, network/console capture and viewport screenshots
 * are additional driver-side checks, not claims made by this script.
 */
(async () => {
  const $ = id => document.getElementById(id);
  const checks = [];
  const check = (label, condition) => {
    if (!condition) throw new Error(label);
    checks.push(label);
  };
  const note = () => $('field-note').textContent.replace(/\s+/g, ' ').trim();
  const choose = (id, value) => {
    const control = $(id);
    control.value = value;
    check(`${id} accepts ${value}`, control.value === value);
    control.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const view = value => document.querySelector(`[data-view="${value}"]`).click();
  const fixture = ({ before = 100, after = 200, count = 60, agent = 'synthetic' } = {}) => ({
    daily: Array.from({ length: count }, (_, i) => {
      const date = new Date('2026-03-30T00:00:00Z');
      date.setUTCDate(date.getUTCDate() - count + 1 + i);
      const tokens = i < count / 2 ? before : after;
      const metrics = { inputTokens: tokens, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: tokens, totalCost: null };
      return { date: date.toISOString().slice(0, 10), ...metrics, agents: [{ agent, modelsUsed: [], ...metrics }] };
    }),
  });
  const paste = report => {
    if ($('paste-panel').hidden) $('paste-toggle').click();
    $('paste-report').value = JSON.stringify(report);
    $('paste-report').dispatchEvent(new Event('input', { bubbles: true }));
    $('preview-paste').click();
    check('synthetic report accepted', $('import-error').hidden);
  };
  const sandbox = document.body.dataset.mode === 'sandbox';
  const deadline = performance.now() + 5000;
  while (!$('field-note')?.querySelector('h2')) {
    if (performance.now() >= deadline) throw new Error('Application did not render within 5 seconds');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  view('overview');
  check('Overview has the new narrative heading', $('field-note').querySelector('h2').textContent === 'What’s the story?');
  const noteHeading = $('field-note').querySelector('h2');
  check('the note landmark is labelled by its heading', Boolean(noteHeading.id) && $('field-note').getAttribute('aria-labelledby') === noteHeading.id);
  if (sandbox) {
    choose('example', 'mixed'); choose('agent', 'all'); choose('range', '90');
    check('default example leads with two observations', $('field-note').querySelectorAll('.story-highlight').length === 2);
    check('weekday story is friendly and backed by the demo', $('field-note').innerText.includes('Wednesdays stand out.') && $('field-note').innerText.includes('2.97M'));
    check('agent story is about recorded share, not preference', $('field-note').innerText.includes('More Hermes in the mix.') && $('field-note').innerText.includes('13% to 27%'));
    check('coverage and context stay visible', $('field-note').querySelector('.story-coverage')?.checkVisibility() && $('field-note').querySelector('.story-context')?.checkVisibility());
    check('unsupported comparisons are secondary, not the story', !$('field-note').querySelector('.story-details').open && !$('field-note').innerText.includes('No comparison.'));
    check('insight text keeps the readable size', parseFloat(getComputedStyle($('field-note').querySelector('.story-insight-text')).fontSize) >= 15);
    const details = $('field-note').querySelector('.story-details');
    details.querySelector('summary').click();
    check('comparison caveats remain available', details.open && $('field-note').innerText.includes('No comparison.'));
    check('calendar totals are distinguished from observed patterns', details.querySelector('.story-comparison h3').textContent === 'Full-window token comparison' && details.textContent.includes('Patterns use observed days'));
    details.querySelector('summary').click();
    for (const [id, count] of [['solo', 1], ['cache', 1], ['unpriced', 2], ['empty', 0]]) {
      choose('example', id); choose('range', '90');
      check(`${id} has its own eligible observations`, $('field-note').querySelectorAll('.story-highlight').length === count);
    }
    choose('example', 'mixed'); choose('range', '30');
    check('short window does not borrow agent evidence from outside it', !$('field-note').querySelector('[data-insight="agent-mix"]'));
    choose('range', '90'); choose('agent', 'codex');
    check('selected agent does not inherit another agent’s growth story', !$('field-note').innerText.includes('More Hermes in the mix.'));
    choose('agent', 'all'); choose('interval', 'weekly');
    check('grouping retains observation facts', $('field-note').innerText.includes('13% to 27%'));
    choose('interval', 'daily');
    paste(fixture());
  }
  choose('agent', 'all');
  choose('range', '30');
  check('complete current total', note().includes('6,000 tokens'));
  check('comparison direction', note().includes('100% more'));
  check('both windows shown', note().includes('Mar 1, 2026 to Mar 30, 2026') && note().includes('Jan 30, 2026 to Feb 28, 2026'));
  check('context is explicit', note().includes('may be incomplete') && note().includes('does not measure productivity or quality'));
  check('recorded summary is a separate emphasized line', $('field-note').querySelector('.story-summary strong')?.textContent === 'All agents recorded 6,000 tokens');
  check('date and coverage have their own line', $('field-note').querySelector('.story-period')?.textContent.trim() === 'from Mar 1, 2026 to Mar 30, 2026 (30 of 30 calendar days observed).');
  check('comparison has a scannable heading', $('field-note').querySelector('.story-comparison h3')?.textContent === 'Comparison');
  check('complete comparisons have no caveat list', !$('field-note').querySelector('.story-reasons'));
  check('context is separate from the comparison', $('field-note').querySelector('.story-context')?.textContent.includes('does not measure productivity or quality'));
  check('story body text is at least 15px', parseFloat(getComputedStyle($('field-note').querySelector('.story-comparison-text')).fontSize) >= 15);
  check('period text is at least 14px', parseFloat(getComputedStyle($('field-note').querySelector('.story-period')).fontSize) >= 14);
  const complete = note();
  choose('interval', 'weekly');
  check('grouping preserves narrative facts', note() === complete);
  choose('interval', 'daily');
  choose('agent', 'synthetic');
  check('agent filter preserves report anchor', note().includes('synthetic recorded 6,000 tokens from Mar 1, 2026 to Mar 30, 2026'));
  choose('agent', 'all');
  const controls = {
    tokens: 'READING THE MIXMost tokens can be context.0.0%This share of input-side tokens was read from cache. It describes context reuse, not money saved. This view sums the four token categories; ccusage’s headline total can differ.TOKEN ACCOUNTING CAN VARY BETWEEN AGENTS',
    cost: 'HANDLE WITH CONTEXTA cost estimate. A different kind of number.ccusage combines recorded usage with available pricing. Subscription plans, cached prices, missing prices, and provider accounting can all make this differ from what you actually pay. Use it to explore patterns.NO BUDGET FORECASTS OR BILLING CLAIMS',
  };
  for (const mode of ['tokens', 'cost']) {
    view(mode);
    check(`${mode} note matches the pre-feature browser baseline`, note() === controls[mode]);
    check(`${mode} has no stale overview prose`, !note().includes('What’s the story?'));
  }
  view('overview');
  check('returning to Overview restores the story', note() === complete);
  choose('range', '90');
  check('short 90-day history is not comparable', note().includes('60 of 90 days available') && !note().includes('%'));
  const reasons = [...$('field-note').querySelectorAll('.story-reasons li')].map(item => item.textContent);
  check('comparison caveats are individual list items', reasons.length === 2 && reasons[0] === 'the current window is partial (60 of 90 days available)' && reasons[1].startsWith('the previous window has missing observations'));
  choose('range', 'all');
  check('all history has no invented baseline', note().includes('9,000 tokens') && note().includes('All history has no comparison baseline') && !note().includes('%'));
  choose('range', '30');
  check('source footer matches mode', note().includes(sandbox ? 'USER-SUPPLIED REPORT' : 'LOCAL SNAPSHOT'));
  if (sandbox) {
    for (const [before, after, expected] of [[200, 100, '50% fewer'], [100, 100, 'unchanged from'], [100, 0, '100% fewer']]) {
      paste(fixture({ before, after }));
      check(`signed comparison ${before}/${after}`, note().includes(expected));
    }
    for (const [after, expected] of [[2011, '0.6% more'], [1989, '0.6% fewer']]) {
      paste(fixture({ before: 2000, after }));
      check(`halfway percentage rounds correctly for ${after}`, note().includes(expected));
    }
    const large = fixture({ before: 0, after: 0 });
    for (const [index, tokens] of [[0, 1000], [30, Number.MAX_SAFE_INTEGER]]) {
      for (const row of [large.daily[index], large.daily[index].agents[0]]) row.inputTokens = row.totalTokens = tokens;
    }
    paste(large);
    check('large comparable total retains its percentage tenth', note().includes('900,719,925,473,999.1% more'));
    for (const after of [0, 200]) {
      paste(fixture({ before: 0, after }));
      check(`zero baseline ${after}`, note().includes('previous window explicitly records 0') && note().includes('percentage change is undefined') && !note().includes('%'));
    }
    const gap = fixture();
    gap.daily = gap.daily.filter(row => row.date !== '2026-03-15');
    paste(gap);
    check('current gap is not zero', note().includes('5,800 tokens') && note().includes('29 of 30 calendar days observed') && note().includes('current window has missing observations') && !note().includes('%'));
    const priorGap = fixture();
    priorGap.daily = priorGap.daily.filter(row => row.date !== '2026-02-15');
    paste(priorGap);
    check('previous gaps suppress comparison', note().includes('previous window has missing observations') && !note().includes('%'));
    paste({ daily: fixture().daily.slice(-15) });
    check('partial window is explained', note().includes('15 of 30 days available') && !note().includes('%'));
    const absent = fixture();
    absent.daily.slice(30).forEach(day => { day.agents[0].agent = 'other'; });
    paste(absent);
    choose('agent', 'synthetic');
    check('selected agent with no current records is unknown', note().includes('No recorded observations are available for synthetic') && note().includes('0 of 30 calendar days observed') && !note().includes('100% fewer'));
    choose('agent', 'all');
    paste(fixture({ count: 180 }));
    choose('range', '90');
    check('complete 90-day comparison', note().includes('18,000 tokens') && note().includes('90 of 90 calendar days observed') && note().includes('100% more'));
    choose('range', '30');
    paste(fixture({ after: Number.MAX_SAFE_INTEGER }));
    check('unsafe total is not formatted as zero', note().includes('A precise recorded-token total is unavailable') && !note().includes('%') && !note().includes('recorded 0 tokens'));
    paste({ daily: [] });
    check('empty report offers another selection', note().includes('No recorded observations') && note().includes('Try a different agent') && !note().includes('0 tokens'));
    check('empty story has no invented period or comparison section', !$('field-note').querySelector('.story-period, .story-comparison'));
    for (const mode of ['tokens', 'cost']) {
      view(mode);
      check(`${mode} preserves its empty state`, note().includes('Your next session starts the story.') && note().includes('No usage was found for this selection.'));
    }
    view('overview');
    const hostile = '<img src=x onerror="document.body.dataset.storyProbe=1">'.padEnd(80, 'x');
    const growing = agent => {
      const report = fixture();
      report.daily.forEach((day, i) => {
        const a = { ...day.agents[0], agent, inputTokens: i < 28 ? 10 : 30, totalTokens: i < 28 ? 10 : 30 };
        const b = { ...a, agent: 'other', inputTokens: 100 - a.totalTokens, totalTokens: 100 - a.totalTokens };
        day.agents = [a, b]; day.inputTokens = day.totalTokens = 100;
      });
      return report;
    };
    for (const label of [hostile, 'S'.repeat(80)]) {
      paste(growing(label)); choose('range', '90');
      check('growing agent label stays literal in the insight', $('field-note').querySelector('[data-insight="agent-mix"] h3')?.textContent.includes(label) && !$('field-note').querySelector('img') && !document.body.dataset.storyProbe);
      check('long insight label stays inside the page', document.documentElement.scrollWidth <= innerWidth + 1);
    }
    choose('range', '30');
    check('hostile fixture is a maximum-length label', hostile.length === 80);
    paste(fixture({ agent: hostile }));
    choose('agent', hostile);
    check('untrusted label renders literally', note().includes(hostile) && !$('field-note').querySelector('img') && !document.body.dataset.storyProbe);
    const longLabel = 'S'.repeat(80);
    paste(fixture({ agent: longLabel }));
    choose('agent', longLabel);
    check('full selected label remains available', $('agent').selectedOptions[0].textContent === longLabel && note().includes(longLabel));
    for (const mode of ['overview', 'tokens', 'cost']) {
      view(mode);
      check(`${mode} maximum-length labels do not widen the page`, document.documentElement.scrollWidth <= innerWidth + 1);
      const rect = $('field-note').getBoundingClientRect();
      check(`${mode} note stays inside the viewport`, rect.left >= 0 && rect.right <= innerWidth + 1);
    }
    view('overview');
    const beforeInvalid = note();
    $('paste-report').value = '{broken';
    $('paste-report').dispatchEvent(new Event('input', { bubbles: true }));
    $('preview-paste').click();
    check('invalid input retains the valid narrative', !$('import-error').hidden && note() === beforeInvalid);
    $('clear-paste').click();
    check('Clear removes the pasted narrative', $('paste-report').value === '' && note().includes('SYNTHETIC EXAMPLE') && !note().includes(hostile) && !note().includes(longLabel));
    check('sandbox does not put the report in history or storage', location.search === '' && location.hash === '' && localStorage.length === 0 && sessionStorage.length === 0);
    paste(fixture());
    choose('agent', 'all');
    choose('range', '30');
  }
  return { mode: sandbox ? 'sandbox' : 'local', checks };

})();
