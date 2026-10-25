// HTML and CSV reports for a finished run. The HTML is fully self-contained (inline SVG charts, no external assets).
'use strict';
const { lineChart, barChart, COLORS, fmtTime } = require('../shared/charts');
const { targetAt } = require('../shared/stages');
const { SCENARIOS } = require('../shared/catalog');
const storage = require('./storage');
const { compareRuns, findAutoBaseline } = require('./compare');

const esc = value => String(value === null || value === undefined ? '' : value).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (value, digits = 1) => (value === null || value === undefined ? 'n/a' : Number(value).toLocaleString('en-US', { maximumFractionDigits: digits }));
const ms = value => (value === null || value === undefined ? 'n/a' : `${fmt(value, value >= 100 ? 0 : 1)} ms`);
const pct = value => (value === null || value === undefined ? 'n/a' : `${fmt(value, 2)}%`);
const scenarioLabel = id => (SCENARIOS.find(s => s.id === id) || { label: id }).label;

const STATE_TEXT = { completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled by user', aborted: 'Stopped by safety limit' };
const THRESHOLD_TEXT = { pass: 'Passed', fail: 'Failed', incomplete: 'Incomplete (some limits not measured)', none: 'No limits configured' };
const CLASS_TEXT = { improvement: 'Improvement', no_material_change: 'No material change', potential_regression: 'Potential regression', confirmed_threshold_failure: 'Confirmed threshold failure', inconclusive: 'Inconclusive' };

const STYLE = `
  :root{--ink:#16231d;--muted:#66706a;--line:#e3e0d6;--card:#fffdf7;--bg:#f6f3ea;--pass:#0a7a3d;--fail:#c0271b;--warn:#a86a00;--accent:#14362a;--code:#efece3}
  @media(prefers-color-scheme:dark){:root{--ink:#e8ece9;--muted:#9aa5a0;--line:#33373c;--card:#1d2024;--bg:#15171a;--pass:#4cc780;--fail:#ff7b6e;--warn:#e0b252;--accent:#8ad3a5;--code:#23272b}}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;padding:28px 16px 80px}
  main{max-width:1060px;margin:0 auto}h1{font-size:28px;margin:0 0 4px}h2{font-size:20px;margin:34px 0 10px;border-bottom:1px solid var(--line);padding-bottom:6px}h3{font-size:16px;margin:18px 0 6px}
  .sub{color:var(--muted);margin:0 0 14px}.badge{display:inline-block;padding:2px 10px;border-radius:99px;font-size:13px;font-weight:600;border:1px solid var(--line);background:var(--card)}
  .pass{color:var(--pass)}.fail{color:var(--fail)}.warn{color:var(--warn)}.muted{color:var(--muted)}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:14px 0}.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
  .card b{display:block;font-size:22px;line-height:1.2}.card span{color:var(--muted);font-size:13px}
  table{border-collapse:collapse;width:100%;font-size:14px;margin:8px 0;background:var(--card)}th,td{text-align:left;padding:6px 9px;border-bottom:1px solid var(--line);vertical-align:top}th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);background:var(--bg)}
  td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}.chart{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 10px;margin:8px 0}
  .note{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--accent);border-radius:6px;padding:10px 14px;margin:10px 0;font-size:14px}
  .note.bad{border-left-color:var(--fail)}.note.warning{border-left-color:var(--warn)}ul{margin:6px 0 6px 18px;padding:0}code{background:var(--code);padding:1px 5px;border-radius:4px;font-size:.92em}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}@media(max-width:760px){.grid2{grid-template-columns:1fr}}.small{font-size:13px}
  @media print{body{background:#fff;padding:0}.chart,.card,table{break-inside:avoid}}`;

function kpi(label, value, extra) { return `<div class="card"><b>${value}</b><span>${esc(label)}${extra ? `<br>${extra}` : ''}</span></div>`; }

function distributionTable(bundle) {
  const config = bundle.config;
  const startedByRole = Object.fromEntries((bundle.roles || []).map(r => [r.role, r.started]));
  const totalStarted = Object.values(startedByRole).reduce((a, b) => a + b, 0) || 1;
  const roleRows = ['HOST', 'VENDOR', 'INVITEE'].map(role => `<tr><td>${role}</td><td class="n">${fmt(config.roleMix[role], 1)}%</td><td class="n">${fmt(((startedByRole[role] || 0) / totalStarted) * 100, 1)}%</td><td class="n">${fmt(startedByRole[role] || 0, 0)}</td></tr>`).join('');
  const weightSum = {};
  for (const s of SCENARIOS) if (!(bundle.unavailableScenarios || {})[s.id]) weightSum[s.role] = (weightSum[s.role] || 0) + (Number(config.scenarioWeights[s.id]) || 0);
  const byId = Object.fromEntries((bundle.journeys || []).map(j => [j.id, j]));
  const rows = SCENARIOS.map(s => {
    const j = byId[s.id]; const unavailable = (bundle.unavailableScenarios || {})[s.id];
    const configured = unavailable ? null : ((Number(config.scenarioWeights[s.id]) || 0) / (weightSum[s.role] || 1)) * 100;
    return `<tr><td>${esc(s.role)}</td><td>${esc(s.label)}<br><span class="muted small">${esc(s.id)}</span>${unavailable ? `<br><span class="warn small">Unavailable: ${esc(unavailable)}</span>` : ''}</td>
      <td class="n">${configured === null ? '–' : `${fmt(configured, 1)}%`}</td><td class="n">${j ? fmt(j.started, 0) : 0}</td><td class="n">${j ? fmt(j.completed, 0) : 0}</td><td class="n">${j ? fmt(j.failed, 0) : 0}</td>
      <td class="n">${j ? fmt(j.avgActions, 1) : '–'}</td><td class="n">${j ? ms(j.latencyMs.p95) : '–'}</td><td class="n">${j ? ms(j.durationMs.p95) : '–'}</td></tr>`;
  }).join('');
  return `<h3>Role distribution</h3><table><thead><tr><th>Role</th><th class="n">Configured</th><th class="n">Observed (journeys)</th><th class="n">Journeys started</th></tr></thead><tbody>${roleRows}</tbody></table>
  <h3>Scenario distribution and results</h3><p class="small muted">"Configured" is the share among that role's available scenarios. A journey is "failed" if any request in it returned an unexpected status or error.</p>
  <table><thead><tr><th>Role</th><th>Scenario</th><th class="n">Configured share</th><th class="n">Started</th><th class="n">Completed</th><th class="n">Failed</th><th class="n">Avg actions</th><th class="n">Request p95</th><th class="n">Journey p95</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function comparisonSection(cmp) {
  if (!cmp) return '';
  const c = cmp.comparability;
  const rows = cmp.metrics.map(m => `<tr><td>${esc(m.label)}</td><td class="n">${fmt(m.baseline, 2)} ${esc(m.unit)}</td><td class="n">${fmt(m.current, 2)} ${esc(m.unit)}</td><td class="n">${m.abs === null ? 'n/a' : `${m.abs > 0 ? '+' : ''}${fmt(m.abs, 2)}`}</td>
    <td class="n">${m.pct === null ? 'n/a' : `${m.pct > 0 ? '+' : ''}${fmt(m.pct, 1)}%`}</td><td class="${m.classification === 'improvement' ? 'pass' : /regression|failure/.test(m.classification) ? 'fail' : 'muted'}">${esc(CLASS_TEXT[m.classification])}${m.note ? `<br><span class="small muted">${esc(m.note)}</span>` : ''}</td></tr>`).join('');
  const reasons = c.reasons.filter(r => r.level !== 'info').map(r => `<li><b>${esc(r.level === 'not_comparable' ? 'Not comparable' : 'Caution')}:</b> ${esc(r.note)}</li>`).join('');
  return `<h2>Comparison with a previous run</h2>
  <div class="note ${c.verdict === 'comparable' ? '' : c.verdict === 'caution' ? 'warning' : 'bad'}"><b>${esc(cmp.verdictText)}</b><br>Baseline: <code>${esc(cmp.baselineId)}</code> (${esc(cmp.baselineName)}). Comparability: <b>${c.verdict === 'comparable' ? 'comparable' : c.verdict === 'caution' ? 'interpret with caution' : 'not directly comparable'}</b>.${reasons ? `<ul>${reasons}</ul>` : ''}</div>
  <table><thead><tr><th>Metric</th><th class="n">Baseline</th><th class="n">This run</th><th class="n">Difference</th><th class="n">%</th><th>Assessment</th></tr></thead><tbody>${rows}</tbody></table>
  <p class="small muted">Tolerances: latency ±${cmp.rules.latencyPct}% (ignoring changes under ${cmp.rules.minAbsLatencyMs} ms), error rate ±${cmp.rules.errorRatePp} points, throughput −${cmp.rules.throughputDropPct}%. These are configurable defaults, not universal guarantees.</p>`;
}

function renderHtml(bundle, comparison) {
  const { config, plan, series, total } = bundle;
  const targetSeries = [];
  for (let t = 0; t <= plan.durationSeconds; t += Math.max(1, Math.floor(plan.durationSeconds / 300))) targetSeries.push([t, targetAt(plan, t)]);
  const markers = plan.stages.slice(1).map(s => ({ x: s.startSeconds, label: s.name }));
  const complete = bundle.complete;
  const r = bundle.resources; const series2 = bundle.targetSeries || [];

  const statusItems = Object.entries(total.statuses || {}).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([code, count]) => ({ label: code === '0' ? 'No response (0)' : `HTTP ${code}`, value: count, color: code === '0' || Number(code) >= 500 ? COLORS.red : Number(code) >= 400 ? COLORS.amber : COLORS.green }));
  const endpointRows = (bundle.endpoints || []).map(e => `<tr><td>${esc(e.name)}</td><td class="n">${fmt(e.requests, 0)}</td><td class="n">${ms(e.latencyMs.avg)}</td><td class="n">${ms(e.latencyMs.p50)}</td><td class="n">${ms(e.latencyMs.p90)}</td><td class="n">${ms(e.latencyMs.p95)}</td><td class="n">${ms(e.latencyMs.p99)}</td><td class="n">${pct(e.errorRatePct)}</td><td class="n">${fmt(e.rejections, 0)}</td></tr>`).join('');
  const thresholdRows = (bundle.thresholds || []).map(t => `<tr><td>${esc(t.label)}</td><td>${esc(t.rule)}</td><td class="n">${t.actual === null ? 'not measured' : `${fmt(t.actual, 2)} ${esc(t.unit)}`}</td><td class="${t.status === 'pass' ? 'pass' : t.status === 'fail' ? 'fail' : 'warn'}">${t.status === 'pass' ? 'Passed' : t.status === 'fail' ? 'Failed' : 'Not measured'}</td></tr>`).join('');
  const bottleneckHtml = (bundle.bottlenecks || []).map(b => `<div class="note ${b.severity === 'critical' ? 'bad' : b.severity === 'warning' ? 'warning' : ''}"><b>${esc(b.title)}</b><ul>${b.evidence.map(e => `<li>${esc(e)}</li>`).join('')}</ul><span class="small muted">${esc(b.explanation)}</span></div>`).join('') || '<p class="muted">No analysis was possible (no data).</p>';

  const resourceTable = r ? `<table><thead><tr><th>Measurement</th><th class="n">Average</th><th class="n">p95</th><th class="n">Max</th><th>Source</th></tr></thead><tbody>
    ${[['Machine CPU', r.loadGeneratorHost.cpuPct, '%', 'OS counters on the machine running this test'], ['Machine memory in use', r.loadGeneratorHost.memUsedPct, '%', 'OS counters'], ['k6 load generator CPU (share of machine)', r.loadGeneratorProcess.cpuPctOfMachine, '%', 'k6 process sampling'], ['k6 load generator memory', r.loadGeneratorProcess.rssMb, 'MB', 'k6 process sampling'],
      ...(r.target ? [['API process CPU (% of one core)', r.target.cpuPctOfOneCore, '%', 'probe in the API process'], ['API process memory (RSS)', r.target.rssMb, 'MB', 'probe'], ['Event-loop lag p99', r.target.eventLoopLagP99Ms, 'ms', 'probe (perf_hooks)'], ['DB connections in use', r.target.dbPoolInUse, `of ${r.target.dbPoolLimit || '?'}`, 'probe (mysql2 pool)'], ['DB requests waiting for a connection', r.target.dbPoolQueued, '', 'probe'], ['DB round-trip (SELECT 1)', r.target.dbRoundTripMs, 'ms', 'probe']] : [])]
      .map(([label, s, unit, source]) => `<tr><td>${esc(label)}</td><td class="n">${s ? `${fmt(s.avg, 1)} ${esc(unit)}` : 'not collected'}</td><td class="n">${s ? fmt(s.p95, 1) : '–'}</td><td class="n">${s ? fmt(s.max, 1) : '–'}</td><td class="muted small">${esc(source)}</td></tr>`).join('')}
    </tbody></table><p class="small"><b>Not collected:</b></p><ul class="small">${r.notCollected.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : '<p class="muted">No resource samples were collected.</p>';

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(bundle.name)} · load test report</title><style>${STYLE}</style></head><body><main>
<h1>${esc(bundle.name)}</h1>
<p class="sub">Load test report · <code>${esc(bundle.runId)}</code> · ${esc(bundle.startedAt || '')} → ${esc(bundle.endedAt)}</p>
<p><span class="badge ${bundle.state === 'completed' ? 'pass' : 'fail'}">Run: ${esc(STATE_TEXT[bundle.state] || bundle.state)}</span> <span class="badge ${bundle.thresholdStatus === 'pass' ? 'pass' : bundle.thresholdStatus === 'fail' ? 'fail' : 'warn'}">Thresholds: ${esc(THRESHOLD_TEXT[bundle.thresholdStatus])}</span> ${complete ? '' : '<span class="badge warn">Partial results: the run did not reach its full duration</span>'}</p>
${bundle.stateReason ? `<div class="note bad">${esc(bundle.stateReason)}</div>` : ''}
<div class="cards">
 ${kpi('Total requests', fmt(total.requests, 0), `${fmt(total.failed, 0)} failed`)}
 ${kpi('Throughput (sustained)', bundle.sustain ? `${fmt(bundle.sustain.rps, 1)}/s` : `${fmt(bundle.avgRps, 1)}/s`, bundle.sustain ? 'during sustained load' : 'average over the run')}
 ${kpi('p95 response time', ms(total.latencyMs.p95), `p99 ${ms(total.latencyMs.p99)}`)}
 ${kpi('Median response time', ms(total.latencyMs.p50), `average ${ms(total.latencyMs.avg)}`)}
 ${kpi('Error rate', pct(total.errorRatePct), `${pct(total.timeoutRatePct)} timeouts`)}
 ${kpi('Concurrent users', `${fmt(bundle.concurrency && bundle.concurrency.achievedPeak, 0)} / ${plan.maxVus}`, 'peak reached / configured')}
</div>
<div class="note"><b>Users are not requests per second.</b> A virtual user is one simulated person running journeys with pauses ("think time") between actions, so ${plan.maxVus} users produce far fewer than ${plan.maxVus} requests at any instant. Throughput here is measured in completed requests per second.</div>

<h2>Load profile and achieved concurrency</h2>
<div class="chart">${lineChart({ yTitle: 'Virtual users', markers, series: [{ name: 'Configured users', color: COLORS.grey, dash: '5 4', data: targetSeries }, { name: 'Active users (k6)', color: COLORS.green, area: true, data: series.map(p => [p.t, p.vus]) }] })}</div>
<table><thead><tr><th>Stage</th><th class="n">Starts</th><th class="n">Length</th><th class="n">Users</th></tr></thead><tbody>${plan.stages.map(s => `<tr><td>${esc(s.name)}</td><td class="n">${fmtTime(s.startSeconds)}</td><td class="n">${s.durationSeconds}s</td><td class="n">${s.fromVus} → ${s.toVus}</td></tr>`).join('')}</tbody></table>
<p class="small muted">Duration (${plan.durationSeconds}s) = warm-up + ramp-up + sustained load + ramp-down. Up to ${plan.gracefulStopSeconds}s of cool-down is allowed afterwards for in-flight journeys; it is not part of the duration. Wall-clock time of this run: ${bundle.wallSeconds}s.
 ${bundle.concurrency ? `During sustained load the average was ${fmt(bundle.concurrency.avgDuringSustain, 1)} users (lowest ${fmt(bundle.concurrency.minDuringSustain, 0)}); shortfall vs. target ${fmt(bundle.concurrency.shortfallPct, 1)}%.` : ''}</p>

<h2>Throughput, errors and latency over time</h2>
<div class="chart">${lineChart({ yTitle: 'Requests per second', markers, series: [{ name: 'Requests/s', color: COLORS.green, area: true, data: series.map(p => [p.t, p.requests]) }, { name: 'Failed/s', color: COLORS.red, data: series.map(p => [p.t, p.failed]) }] })}</div>
<div class="chart">${lineChart({ yTitle: 'Response time (ms)', yFormat: v => `${Math.round(v)}`, markers, series: [{ name: 'Average', color: COLORS.lime, data: series.map(p => [p.t, p.avg]) }, { name: 'p95', color: COLORS.coral, data: series.map(p => [p.t, p.p95]) }, { name: 'p99', color: COLORS.purple, data: series.map(p => [p.t, p.p99]) }] })}</div>
<div class="grid2"><div><h3>HTTP status codes</h3><div class="chart">${barChart({ items: statusItems, labelWidth: 110, title: 'status codes' })}</div></div>
<div><h3>Latency summary</h3><table><tbody>${[['Average', total.latencyMs.avg], ['Median (p50)', total.latencyMs.p50], ['p90', total.latencyMs.p90], ['p95', total.latencyMs.p95], ['p99', total.latencyMs.p99], ['Max', total.latencyMs.max]].map(([l, v]) => `<tr><td>${l}</td><td class="n">${ms(v)}</td></tr>`).join('')}
 <tr><td>Data received</td><td class="n">${fmt((total.bytesIn || 0) / 1048576, 1)} MB</td></tr><tr><td>Expected refusals (4xx)</td><td class="n">${fmt(total.rejections, 0)}</td></tr><tr><td>Connection errors</td><td class="n">${fmt(total.connectionErrors, 0)}</td></tr></tbody></table>
 <p class="small muted">Percentiles come from a log-bucket histogram (about ±1% accuracy). Requests that never received a response are counted as errors but excluded from latency.</p></div></div>

<h2>Thresholds</h2>
${thresholdRows ? `<table><thead><tr><th>Measure</th><th>Limit</th><th class="n">Result</th><th>Status</th></tr></thead><tbody>${thresholdRows}</tbody></table>` : '<p class="muted">No thresholds configured.</p>'}
<p class="small muted">Latency and error limits are checked against the whole run; the throughput limit against the sustained-load period. A limit that could not be measured is shown as "not measured", never as passed.</p>
${comparisonSection(comparison)}
<h2>Bottleneck analysis</h2>${bottleneckHtml}
<h2>Workload: roles and scenarios</h2>${distributionTable(bundle)}
<h2>Endpoint performance</h2>
<table><thead><tr><th>Endpoint</th><th class="n">Requests</th><th class="n">Avg</th><th class="n">p50</th><th class="n">p90</th><th class="n">p95</th><th class="n">p99</th><th class="n">Errors</th><th class="n">Refusals</th></tr></thead><tbody>${endpointRows}</tbody></table>
<h2>System resources</h2>
${series2.length ? `<div class="grid2"><div class="chart">${lineChart({ height: 200, yTitle: 'CPU %', series: [{ name: 'Machine', color: COLORS.grey, data: series2.map(p => [p.t, p.systemCpuPct]) }, { name: 'API (of 1 core)', color: COLORS.coral, data: series2.map(p => [p.t, p.targetCpuPct]) }, { name: 'k6', color: COLORS.blue, data: series2.map(p => [p.t, p.generatorCpuPct]) }] })}</div>
<div class="chart">${lineChart({ height: 200, yTitle: 'Event-loop lag p99 (ms) and DB connections in use', series: [{ name: 'Event-loop lag p99 ms', color: COLORS.purple, data: series2.map(p => [p.t, p.lagP99Ms]) }, { name: 'DB conns in use', color: COLORS.green, data: series2.map(p => [p.t, p.poolInUse]) }] })}</div></div>` : ''}
${resourceTable}
<h2>Top errors</h2>${(bundle.topErrors || []).length ? `<table><thead><tr><th>Cause</th><th class="n">Count</th></tr></thead><tbody>${bundle.topErrors.map(e => `<tr><td>${esc(e.reason)}</td><td class="n">${fmt(e.count, 0)}</td></tr>`).join('')}</tbody></table>` : '<p class="pass">No unexpected failures were recorded.</p>'}
<h2>Environment, build and reproducibility</h2>
<table><tbody>
<tr><td>Environment</td><td>${esc(bundle.environment.label)} (<code>${esc(bundle.environment.key)}</code>, ${esc(bundle.environment.type)})</td></tr>
<tr><td>Application build</td><td>commit <code>${esc((bundle.build.commit || 'unknown').slice(0, 12))}</code>${bundle.build.dirty ? ' + uncommitted changes' : ''}, app v${esc(bundle.build.appVersion)}, ${esc(bundle.build.node)}</td></tr>
<tr><td>Load engine</td><td>${esc(bundle.build.k6)}</td></tr>
<tr><td>Random seed</td><td><code>${esc(config.seed)}</code> — repeat with the same configuration and seed to reproduce the same per-user choices.</td></tr>
<tr><td>Think time / pacing</td><td>${config.thinkTime.minMs}–${config.thinkTime.maxMs} ms between actions; at least ${config.pacing.minRequestGapMs} ms between a user's requests; ${config.journey.minActions}–${config.journey.maxActions} actions per journey (${Math.round(config.journey.earlyStopChance * 100)}% leave early)</td></tr>
<tr><td>Negative testing</td><td>${config.negativeTesting.enabled ? `on (${Math.round(config.negativeTesting.rate * 100)}% of actions followed by an intentionally invalid request)` : 'off'}</td></tr>
<tr><td>Test data</td><td>${esc(bundle.dataStrategy.writes)}. Accounts: ${esc(JSON.stringify(bundle.dataStrategy.accounts))}, ${bundle.dataStrategy.eventsPerHost} seeded events per host, at most ${bundle.dataStrategy.maxCreatedPerUser} created records per user kept at once.</td></tr>
<tr><td>Safety stop</td><td>abort if the error rate stays ≥ ${config.safety.abortErrorRatePct}% for ${config.safety.abortAfterSeconds}s</td></tr>
</tbody></table>
<p class="small muted">Credentials and tokens are never written to reports. Generated by the Gather load-testing module.</p>
</main></body></html>`;
}

const csvCell = value => { const s = value === null || value === undefined ? '' : String(value); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const toCsv = (header, rows) => [header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');

function renderCsv(kind, bundle) {
  if (kind === 'endpoints') return toCsv(['endpoint', 'requests', 'failed', 'timeouts', 'rejections', 'error_rate_pct', 'avg_ms', 'p50_ms', 'p90_ms', 'p95_ms', 'p99_ms', 'max_ms'],
    bundle.endpoints.map(e => [e.name, e.requests, e.failed, e.timeouts, e.rejections, e.errorRatePct, e.latencyMs.avg, e.latencyMs.p50, e.latencyMs.p90, e.latencyMs.p95, e.latencyMs.p99, e.latencyMs.max]));
  if (kind === 'scenarios') return toCsv(['scenario', 'role', 'started', 'completed', 'failed', 'avg_actions', 'requests', 'request_p50_ms', 'request_p95_ms', 'journey_p95_ms'],
    bundle.journeys.map(j => [j.id, j.role, j.started, j.completed, j.failed, j.avgActions, j.requests, j.latencyMs.p50, j.latencyMs.p95, j.durationMs.p95]));
  if (kind === 'timeseries') {
    const byTime = new Map((bundle.targetSeries || []).map(p => [p.t, p]));
    return toCsv(['second', 'virtual_users', 'requests', 'failed', 'timeouts', 'avg_ms', 'p50_ms', 'p90_ms', 'p95_ms', 'p99_ms', 'machine_cpu_pct', 'api_cpu_pct_of_core', 'event_loop_lag_p99_ms', 'db_pool_in_use'],
      bundle.series.map(p => { const x = byTime.get(p.t) || {}; return [p.t, p.vus, p.requests, p.failed, p.timeouts, p.avg, p.p50, p.p90, p.p95, p.p99, x.systemCpuPct, x.targetCpuPct, x.lagP99Ms, x.poolInUse]; }));
  }
  if (kind === 'summary') {
    const rows = [['run_id', bundle.runId], ['name', bundle.name], ['state', bundle.state], ['started_at', bundle.startedAt], ['ended_at', bundle.endedAt], ['environment', bundle.environment.key], ['commit', bundle.build.commit], ['seed', bundle.config.seed],
      ['max_vus', bundle.plan.maxVus], ['duration_s', bundle.plan.durationSeconds], ['requests', bundle.total.requests], ['failed', bundle.total.failed], ['error_rate_pct', bundle.total.errorRatePct], ['avg_ms', bundle.total.latencyMs.avg],
      ['p50_ms', bundle.total.latencyMs.p50], ['p90_ms', bundle.total.latencyMs.p90], ['p95_ms', bundle.total.latencyMs.p95], ['p99_ms', bundle.total.latencyMs.p99], ['sustained_rps', bundle.sustain && bundle.sustain.rps], ['avg_rps', bundle.avgRps],
      ...bundle.thresholds.map(t => [`threshold_${t.id}`, `${t.status} (limit ${t.limit}, actual ${t.actual})`])];
    return toCsv(['key', 'value'], rows);
  }
  throw new Error('Unknown CSV kind');
}

function loadBundle(runId) {
  const summary = storage.readSummary(runId); const series = storage.readSeries(runId);
  if (!summary || !series) return null;
  return { ...summary, series: series.series, targetSeries: series.resources };
}

// Writes report.html (+ comparison.json when a comparable earlier run exists). Safe to call again later.
function writeReports(runId) {
  const bundle = loadBundle(runId);
  if (!bundle) throw new Error('Run has no results to report');
  let comparison = null;
  if (bundle.config.comparison.autoBaseline && bundle.complete) {
    const others = storage.listRuns().filter(m => m.id !== runId && m.state === 'completed' && m.complete).map(m => storage.readSummary(m.id)).filter(Boolean);
    const found = findAutoBaseline(bundle, others);
    if (found) { comparison = compareRuns(found.run, bundle); storage.writeJson(storage.reportPath(runId, 'comparison.json'), comparison); }
  }
  require('node:fs').writeFileSync(storage.reportPath(runId, 'report.html'), renderHtml(bundle, comparison));
  return { comparison: Boolean(comparison) };
}

module.exports = { renderHtml, renderCsv, writeReports, loadBundle, CLASS_TEXT };
