// Fair performance comparison between two stored runs.
//
// Step 1 decides whether the runs are comparable at all (same environment, similar load, similar workload mix...).
// Step 2 compares each metric and classifies the change. A metric is never called a regression when the runs were not
// comparable or the measurement is missing; those cases are "inconclusive".
'use strict';
const { ROLE_ORDER } = require('../shared/weights');
const { SCENARIOS } = require('../shared/catalog');
const { round } = require('./aggregate');

const DEFAULT_RULES = { latencyPct: 10, errorRatePp: 0.5, throughputDropPct: 10, minAbsLatencyMs: 5, minSamples: 30 };
const CLASSES = ['improvement', 'no_material_change', 'potential_regression', 'confirmed_threshold_failure', 'inconclusive'];

const pctDiff = (a, b) => (a === 0 ? null : ((b - a) / a) * 100);
const relDiff = (a, b) => (Math.max(Math.abs(a), Math.abs(b)) === 0 ? 0 : Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b)));
const num = v => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
const get = (obj, path) => path.split('.').reduce((o, k) => (o === null || o === undefined ? undefined : o[k]), obj);
const rank = { comparable: 0, caution: 1, not_comparable: 2 };

function mixDistance(a, b) { return Math.max(...ROLE_ORDER.map(role => Math.abs((Number(a[role]) || 0) - (Number(b[role]) || 0)))); }

// Total-variation distance between the two workloads' scenario shares (0 = identical, 1 = completely different).
function scenarioDistance(configA, configB, unavailableA, unavailableB) {
  const share = (config, unavailable) => {
    const shares = {};
    for (const role of ROLE_ORDER) {
      const roleShare = (Number(config.roleMix[role]) || 0) / 100;
      const eligible = SCENARIOS.filter(s => s.role === role && !(unavailable || {})[s.id]).map(s => ({ id: s.id, w: Number(config.scenarioWeights[s.id] !== undefined ? config.scenarioWeights[s.id] : s.defaultWeight) || 0 }));
      const total = eligible.reduce((sum, e) => sum + e.w, 0) || 1;
      for (const e of eligible) shares[e.id] = roleShare * (e.w / total);
    }
    return shares;
  };
  const sa = share(configA, unavailableA); const sb = share(configB, unavailableB);
  const ids = new Set([...Object.keys(sa), ...Object.keys(sb)]);
  let total = 0;
  for (const id of ids) total += Math.abs((sa[id] || 0) - (sb[id] || 0));
  return total / 2;
}

function assessComparability(baseline, current) {
  const reasons = [];
  let verdict = 'comparable';
  const flag = (level, field, note, b, c) => { reasons.push({ level, field, note, baseline: b, current: c }); if (rank[level] > rank[verdict]) verdict = level; };
  const info = (field, note, b, c) => reasons.push({ level: 'info', field, note, baseline: b, current: c });

  if (!baseline.complete) flag('not_comparable', 'completion', `The baseline did not complete (${baseline.state}${baseline.stateReason ? `: ${baseline.stateReason}` : ''}).`, baseline.state, current.state);
  if (!current.complete) flag('not_comparable', 'completion', `The current run did not complete (${current.state}${current.stateReason ? `: ${current.stateReason}` : ''}).`, baseline.state, current.state);
  if (baseline.environment.key !== current.environment.key) flag('not_comparable', 'environment', 'Different target environments.', baseline.environment.key, current.environment.key);

  const bc = baseline.config; const cc = current.config;
  const vusDiff = relDiff(bc.maxVus, cc.maxVus);
  if (vusDiff > 0.5) flag('not_comparable', 'maxVus', 'Maximum concurrent users differ by more than 50%.', bc.maxVus, cc.maxVus);
  else if (vusDiff > 0.1) flag('caution', 'maxVus', 'Maximum concurrent users differ by more than 10%.', bc.maxVus, cc.maxVus);
  const achieved = [baseline.concurrency && baseline.concurrency.avgDuringSustain, current.concurrency && current.concurrency.avgDuringSustain].map(num);
  if (achieved[0] !== null && achieved[1] !== null && relDiff(achieved[0], achieved[1]) > 0.15) flag('caution', 'achievedConcurrency', 'Concurrency actually reached during sustained load differs by more than 15%.', achieved[0], achieved[1]);
  const durDiff = relDiff(bc.durationSeconds, cc.durationSeconds);
  if (durDiff > 0.5) flag('caution', 'duration', 'Test durations differ by more than 50%.', bc.durationSeconds, cc.durationSeconds);
  const sustain = [baseline.plan.sustainSeconds, current.plan.sustainSeconds];
  if (relDiff(sustain[0], sustain[1]) > 0.5) flag('caution', 'sustain', 'Sustained-load periods differ by more than 50%.', sustain[0], sustain[1]);
  if (relDiff(bc.rampUpSeconds, cc.rampUpSeconds) > 0.5) info('rampUp', 'Ramp-up durations differ; early-run latency may not line up.', bc.rampUpSeconds, cc.rampUpSeconds);

  const mix = mixDistance(bc.roleMix, cc.roleMix);
  if (mix > 20) flag('not_comparable', 'roleMix', 'Role distribution differs by more than 20 percentage points.', bc.roleMix, cc.roleMix);
  else if (mix > 5) flag('caution', 'roleMix', 'Role distribution differs by more than 5 percentage points.', bc.roleMix, cc.roleMix);
  const scenarioDiff = scenarioDistance(bc, cc, baseline.unavailableScenarios, current.unavailableScenarios);
  if (scenarioDiff > 0.3) flag('not_comparable', 'scenarioMix', `The mix of user journeys differs substantially (${round(scenarioDiff * 100, 0)}% of traffic shifted).`, null, null);
  else if (scenarioDiff > 0.1) flag('caution', 'scenarioMix', `The mix of user journeys differs (${round(scenarioDiff * 100, 0)}% of traffic shifted).`, null, null);
  if (Boolean(bc.negativeTesting.enabled) !== Boolean(cc.negativeTesting.enabled)) flag('not_comparable', 'negativeTesting', 'Only one run included intentionally invalid requests.', bc.negativeTesting.enabled, cc.negativeTesting.enabled);
  if (relDiff(bc.thinkTime.minMs + bc.thinkTime.maxMs, cc.thinkTime.minMs + cc.thinkTime.maxMs) > 0.25) flag('caution', 'thinkTime', 'Think-time ranges differ, which changes the requests each user generates.', bc.thinkTime, cc.thinkTime);
  const accounts = [baseline.dataStrategy && baseline.dataStrategy.accounts, current.dataStrategy && current.dataStrategy.accounts];
  if (accounts[0] && accounts[1]) {
    const sizeA = Object.values(accounts[0]).reduce((a, b) => a + b, 0); const sizeB = Object.values(accounts[1]).reduce((a, b) => a + b, 0);
    if (relDiff(sizeA, sizeB) > 0.3 || relDiff(bc.data.eventsPerHost, cc.data.eventsPerHost) > 0.3) flag('caution', 'testData', 'The size of the seeded data pool differs by more than 30%.', accounts[0], accounts[1]);
  }
  const k6Major = v => (String(v || '').match(/v?(\d+)\./) || [])[1];
  if (k6Major(baseline.build.k6) !== k6Major(current.build.k6)) flag('caution', 'engine', 'Different k6 major versions.', baseline.build.k6, current.build.k6);
  if (baseline.generator && baseline.generator.saturated) flag('caution', 'generatorSaturation', 'The baseline machine was CPU-saturated, so its numbers may reflect the load generator.', true, false);
  if (current.generator && current.generator.saturated) flag('caution', 'generatorSaturation', 'The current run\'s machine was CPU-saturated, so its numbers may reflect the load generator.', false, true);
  const smallest = Math.min(baseline.total.requests, current.total.requests);
  if (smallest < 2000) flag('caution', 'sampleSize', `Only ${smallest} requests in the smaller run: a few slow requests (for example logins) can move percentiles a lot, so small differences are likely noise.`, baseline.total.requests, current.total.requests);
  if (baseline.build.commit !== current.build.commit) info('commit', 'Different application commits (this is usually what is being compared).', baseline.build.commit && baseline.build.commit.slice(0, 8), current.build.commit && current.build.commit.slice(0, 8));
  if (baseline.build.dirty || current.build.dirty) info('uncommittedChanges', 'At least one run was made with uncommitted changes, so the commit id does not fully identify the code.', baseline.build.dirty, current.build.dirty);
  if (bc.seed !== cc.seed) info('seed', 'Different random seeds: the exact sequence of choices differs, though the distribution is the same.', bc.seed, cc.seed);
  return { verdict, reasons };
}

function classify({ direction, baseline, current, rules, comparability, kind, thresholdFailed, baselineThresholdFailed, absOverride }) {
  const b = num(baseline); const c = num(current);
  const out = { baseline: b, current: c, abs: null, pct: null, classification: 'inconclusive', note: '' };
  if (b === null || c === null) { out.note = `Not collected in ${b === null && c === null ? 'either run' : b === null ? 'the baseline' : 'the current run'}.`; return out; }
  out.abs = round(c - b, 3);
  out.pct = round(pctDiff(b, c), 1);
  if (comparability.verdict === 'not_comparable') { out.note = 'Runs are not directly comparable, so this change cannot be attributed to the code.'; return out; }
  let worse = false; let better = false;
  if (kind === 'latency') {
    if (Math.abs(c - b) < rules.minAbsLatencyMs) { out.classification = 'no_material_change'; out.note = `Change is smaller than ${rules.minAbsLatencyMs} ms.`; return out; }
    worse = out.pct !== null && out.pct > rules.latencyPct; better = out.pct !== null && out.pct < -rules.latencyPct;
  } else if (kind === 'rate') {
    worse = c - b > rules.errorRatePp; better = b - c > rules.errorRatePp;
  } else if (kind === 'throughput') {
    worse = out.pct !== null && out.pct < -rules.throughputDropPct; better = out.pct !== null && out.pct > rules.throughputDropPct;
  } else if (kind === 'resource') {
    worse = out.pct !== null && out.pct > rules.latencyPct && Math.abs(c - b) > (absOverride || 1); better = out.pct !== null && out.pct < -rules.latencyPct && Math.abs(c - b) > (absOverride || 1);
  }
  out.classification = worse ? 'potential_regression' : better ? 'improvement' : 'no_material_change';
  // A metric that now breaks its configured limit (and met it before) is a confirmed failure, not just a drift.
  if (thresholdFailed && !baselineThresholdFailed) { out.classification = 'confirmed_threshold_failure'; out.note = 'The current run breaks its configured limit and the baseline did not.'; }
  else if (thresholdFailed) out.note = 'The current run breaks its configured limit (the baseline did too).';
  return out;
}

function compareRuns(baseline, current, options = {}) {
  const rules = { ...DEFAULT_RULES, ...(options.rules || {}), ...(current.config && current.config.comparison ? pickRules(current.config.comparison) : {}), ...(options.rules || {}) };
  const comparability = assessComparability(baseline, current);
  const failed = id => (current.thresholds || []).some(t => t.id === id && t.status === 'fail');
  const baselineFailed = id => (baseline.thresholds || []).some(t => t.id === id && t.status === 'fail');
  const caution = comparability.verdict === 'caution';
  const row = (id, label, unit, direction, kind, b, c, extra = {}) => ({ id, label, unit, direction, kind, ...classify({ direction, kind, baseline: b, current: c, rules, comparability, ...extra }), caution: caution || undefined });

  const metrics = [
    row('avg', 'Average response time', 'ms', 'lower', 'latency', get(baseline, 'total.latencyMs.avg'), get(current, 'total.latencyMs.avg')),
    row('p50', 'Median (p50) response time', 'ms', 'lower', 'latency', get(baseline, 'total.latencyMs.p50'), get(current, 'total.latencyMs.p50')),
    row('p90', 'p90 response time', 'ms', 'lower', 'latency', get(baseline, 'total.latencyMs.p90'), get(current, 'total.latencyMs.p90')),
    row('p95', 'p95 response time', 'ms', 'lower', 'latency', get(baseline, 'total.latencyMs.p95'), get(current, 'total.latencyMs.p95'), { thresholdFailed: failed('p95Ms'), baselineThresholdFailed: baselineFailed('p95Ms') }),
    row('p99', 'p99 response time', 'ms', 'lower', 'latency', get(baseline, 'total.latencyMs.p99'), get(current, 'total.latencyMs.p99'), { thresholdFailed: failed('p99Ms'), baselineThresholdFailed: baselineFailed('p99Ms') }),
    row('errorRate', 'Error rate', '%', 'lower', 'rate', get(baseline, 'total.errorRatePct'), get(current, 'total.errorRatePct'), { thresholdFailed: failed('errorRatePct'), baselineThresholdFailed: baselineFailed('errorRatePct') }),
    row('timeoutRate', 'Timeout rate', '%', 'lower', 'rate', get(baseline, 'total.timeoutRatePct'), get(current, 'total.timeoutRatePct'), { thresholdFailed: failed('timeoutRatePct'), baselineThresholdFailed: baselineFailed('timeoutRatePct') })
  ];
  // Throughput is only meaningful when the load and the error rates were similar.
  const rpsB = num(get(baseline, 'sustain.rps')) ?? num(baseline.avgRps); const rpsC = num(get(current, 'sustain.rps')) ?? num(current.avgRps);
  const throughput = row('throughput', 'Throughput (sustained)', 'req/s', 'higher', 'throughput', rpsB, rpsC, { thresholdFailed: failed('minRps'), baselineThresholdFailed: baselineFailed('minRps') });
  const concB = num(get(baseline, 'concurrency.avgDuringSustain')); const concC = num(get(current, 'concurrency.avgDuringSustain'));
  const errDelta = Math.abs((num(get(current, 'total.errorRatePct')) || 0) - (num(get(baseline, 'total.errorRatePct')) || 0));
  if (throughput.classification !== 'inconclusive' && ((concB !== null && concC !== null && relDiff(concB, concC) > 0.1) || errDelta > 1)) {
    throughput.classification = 'inconclusive';
    throughput.note = errDelta > 1 ? 'Error rates differ by more than 1 point, so throughput is not comparable.' : 'Achieved concurrency differs by more than 10%; throughput scales with users, so this is not a like-for-like comparison.';
  }
  metrics.push(throughput);
  metrics.push({ id: 'achievedConcurrency', label: 'Achieved concurrency (sustained)', unit: 'users', direction: 'neutral', kind: 'info', baseline: concB, current: concC, abs: concB !== null && concC !== null ? round(concC - concB, 1) : null,
    pct: concB ? round(pctDiff(concB, concC), 1) : null, classification: 'no_material_change', note: 'Context only: not scored.' });
  metrics.push({ id: 'requests', label: 'Total requests', unit: '', direction: 'neutral', kind: 'info', baseline: baseline.total.requests, current: current.total.requests, abs: current.total.requests - baseline.total.requests,
    pct: baseline.total.requests ? round(pctDiff(baseline.total.requests, current.total.requests), 1) : null, classification: 'no_material_change', note: 'Context only: not scored.' });

  const keyed = (list, key) => new Map((list || []).map(item => [item[key], item]));
  const eb = keyed(baseline.endpoints, 'name'); const endpoints = [];
  for (const e of current.endpoints || []) {
    const b = eb.get(e.name);
    if (!b || b.requests < rules.minSamples || e.requests < rules.minSamples) continue;
    endpoints.push({ name: e.name, requestsBaseline: b.requests, requestsCurrent: e.requests,
      p95: row('p95', 'p95', 'ms', 'lower', 'latency', b.latencyMs.p95, e.latencyMs.p95), errorRate: row('errorRate', 'Error rate', '%', 'lower', 'rate', b.errorRatePct, e.errorRatePct) });
  }
  const jb = keyed(baseline.journeys, 'id'); const journeys = [];
  for (const j of current.journeys || []) {
    const b = jb.get(j.id);
    if (!b || b.requests < rules.minSamples || j.requests < rules.minSamples) continue;
    journeys.push({ id: j.id, role: j.role, requestsBaseline: b.requests, requestsCurrent: j.requests,
      p95: row('p95', 'Request p95', 'ms', 'lower', 'latency', b.latencyMs.p95, j.latencyMs.p95), duration: row('duration', 'Journey duration p95', 'ms', 'lower', 'latency', b.durationMs.p95, j.durationMs.p95) });
  }
  const resources = [];
  if (baseline.resources && current.resources) {
    const r = (id, label, unit, path, abs) => resources.push(row(id, label, unit, 'lower', 'resource', get(baseline.resources, path), get(current.resources, path), { absOverride: abs }));
    r('targetCpu', 'API process CPU (avg, % of one core)', '%', 'target.cpuPctOfOneCore.avg', 3);
    r('targetCpuP95', 'API process CPU (p95, % of one core)', '%', 'target.cpuPctOfOneCore.p95', 3);
    r('targetRss', 'API process memory (avg RSS)', 'MB', 'target.rssMb.avg', 10);
    r('eventLoopLag', 'Event-loop lag p99 (p95 of samples)', 'ms', 'target.eventLoopLagP99Ms.p95', 5);
    r('poolInUse', 'DB connections in use (p95)', 'conns', 'target.dbPoolInUse.p95', 0.5);
    r('dbRoundTrip', 'DB round-trip SELECT 1 (p95)', 'ms', 'target.dbRoundTripMs.p95', 2);
  }
  const all = [...metrics, ...endpoints.flatMap(e => [e.p95, e.errorRate]), ...journeys.flatMap(j => [j.p95, j.duration]), ...resources];
  const count = c => all.filter(m => m.classification === c).length;
  const headline = metrics.filter(m => m.kind !== 'info');
  const verdictText = comparability.verdict === 'not_comparable'
    ? 'These runs are not directly comparable. The numbers are shown for reference, but no regression or improvement is claimed.'
    : headline.some(m => m.classification === 'confirmed_threshold_failure') ? 'Confirmed threshold failure: the current run breaks a configured limit that the baseline met.'
      : headline.some(m => m.classification === 'potential_regression') ? `Potential regression${caution ? ' (interpret with caution)' : ''}: ${headline.filter(m => m.classification === 'potential_regression').map(m => m.label).join(', ')} got worse beyond the configured tolerance.`
        : headline.some(m => m.classification === 'improvement') ? `Improvement${caution ? ' (interpret with caution)' : ''}: ${headline.filter(m => m.classification === 'improvement').map(m => m.label).join(', ')} improved beyond the configured tolerance.`
          : headline.every(m => m.classification === 'inconclusive') ? 'Inconclusive: the key measurements are missing from one of the runs.'
            : `No material change${caution ? ' (interpret with caution)' : ''}.`;
  return { baselineId: baseline.runId, currentId: current.runId, baselineName: baseline.name, currentName: current.name, rules, comparability, metrics, endpoints, journeys, resources, verdictText,
    counts: Object.fromEntries(CLASSES.map(c => [c, count(c)])) };
}

function pickRules(source) { return { latencyPct: source.latencyPct, errorRatePp: source.errorRatePp, throughputDropPct: source.throughputDropPct, minAbsLatencyMs: source.minAbsLatencyMs, minSamples: source.minSamples }; }

// Latest earlier completed run in the same environment that can be fairly compared with `current`.
function findAutoBaseline(current, candidates) {
  let fallback = null;
  for (const candidate of candidates) {
    if (candidate.runId === current.runId || !candidate.complete || candidate.state !== 'completed') continue;
    if (String(candidate.startedAt) >= String(current.startedAt)) continue;
    const { verdict } = assessComparability(candidate, current);
    if (verdict === 'comparable') return { run: candidate, verdict };
    if (verdict === 'caution' && !fallback) fallback = { run: candidate, verdict };
  }
  return fallback;
}

module.exports = { compareRuns, assessComparability, findAutoBaseline, scenarioDistance, DEFAULT_RULES, CLASSES };
