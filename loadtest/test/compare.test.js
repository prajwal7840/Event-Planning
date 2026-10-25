const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compareRuns, assessComparability, findAutoBaseline, scenarioDistance } = require('../lib/compare');
const { makeRun } = require('./fixtures');

const metric = (cmp, id) => cmp.metrics.find(m => m.id === id);
const class_ = (cmp, id) => metric(cmp, id).classification;

test('identical conditions with tiny differences are comparable and show no material change', () => {
  const a = makeRun({ runId: 'run-20261001-100000-aaaa' }); const b = makeRun({ runId: 'run-20261002-100000-bbbb', startedAt: '2026-10-02T10:00:00.000Z', latency: { avg: 41, p50: 20.5, p90: 152, p95: 305, p99: 610 } });
  const cmp = compareRuns(a, b);
  assert.equal(cmp.comparability.verdict, 'comparable');
  for (const id of ['avg', 'p50', 'p90', 'p95', 'p99', 'errorRate']) assert.equal(class_(cmp, id), 'no_material_change', id);
  assert.match(cmp.verdictText, /No material change/);
});

test('latency beyond the tolerance is a potential regression, below it an improvement', () => {
  const base = makeRun();
  const worse = compareRuns(base, makeRun({ runId: 'run-20261002-100000-bbbb', latency: { p95: 360 } })); // +20%
  assert.equal(class_(worse, 'p95'), 'potential_regression'); assert.equal(metric(worse, 'p95').abs, 60); assert.equal(metric(worse, 'p95').pct, 20);
  assert.match(worse.verdictText, /Potential regression/);
  const better = compareRuns(base, makeRun({ runId: 'run-20261002-100000-bbbb', latency: { p95: 200 } }));
  assert.equal(class_(better, 'p95'), 'improvement'); assert.match(better.verdictText, /Improvement/);
  const tolerant = compareRuns(base, makeRun({ runId: 'run-20261002-100000-bbbb', latency: { p95: 360 } }), { rules: { latencyPct: 25 } });
  assert.equal(class_(tolerant, 'p95'), 'no_material_change', 'the regression threshold is configurable');
});

test('tiny absolute latency changes are ignored even when the percentage is large', () => {
  const cmp = compareRuns(makeRun({ latency: { p50: 2 } }), makeRun({ runId: 'run-20261002-100000-bbbb', latency: { p50: 3 } })); // +50% but 1 ms
  assert.equal(class_(cmp, 'p50'), 'no_material_change');
});

test('error rate is judged in percentage points and a newly broken limit is a confirmed failure', () => {
  const base = makeRun({ total: { errorRatePct: 0.2, failed: 40 } });
  const slightly = compareRuns(base, makeRun({ runId: 'run-20261002-100000-bbbb', total: { errorRatePct: 0.4 } }));
  assert.equal(class_(slightly, 'errorRate'), 'no_material_change', '0.2 points is inside the 0.5 tolerance');
  const worse = compareRuns(base, makeRun({ runId: 'run-20261002-100000-bbbb', total: { errorRatePct: 0.9 } }));
  assert.equal(class_(worse, 'errorRate'), 'potential_regression');
  const broken = compareRuns(base, makeRun({ runId: 'run-20261002-100000-bbbb', total: { errorRatePct: 3 } })); // limit 1%
  assert.equal(class_(broken, 'errorRate'), 'confirmed_threshold_failure'); assert.match(broken.verdictText, /Confirmed threshold failure/);
  const stillBroken = compareRuns(makeRun({ total: { errorRatePct: 3 } }), makeRun({ runId: 'run-20261002-100000-bbbb', total: { errorRatePct: 3 } }));
  assert.equal(class_(stillBroken, 'errorRate'), 'no_material_change', 'already failing before: not a new confirmed failure');
});

test('runs in different environments, or incomplete runs, are not comparable and nothing is called a regression', () => {
  const base = makeRun(); const other = makeRun({ runId: 'run-20261002-100000-bbbb', latency: { p95: 900 } });
  other.environment = { key: 'staging', label: 'Staging', type: 'external' };
  const cmp = compareRuns(base, other);
  assert.equal(cmp.comparability.verdict, 'not_comparable');
  assert.equal(class_(cmp, 'p95'), 'inconclusive'); assert.match(cmp.verdictText, /not directly comparable/);
  const cancelled = makeRun({ runId: 'run-20261002-100000-cccc' }); cancelled.complete = false; cancelled.state = 'cancelled';
  assert.equal(assessComparability(base, cancelled).verdict, 'not_comparable');
});

test('different load or workload makes the comparison cautious or not comparable', () => {
  const base = makeRun();
  assert.equal(assessComparability(base, makeRun({ config: { maxVus: 115 } })).verdict, 'caution', '15% more users');
  assert.equal(assessComparability(base, makeRun({ config: { maxVus: 300 } })).verdict, 'not_comparable', '3x users');
  assert.equal(assessComparability(base, makeRun({ config: { roleMix: { HOST: 60, VENDOR: 15, INVITEE: 25 } } })).verdict, 'caution');
  assert.equal(assessComparability(base, makeRun({ config: { roleMix: { HOST: 90, VENDOR: 5, INVITEE: 5 } } })).verdict, 'not_comparable');
  assert.equal(assessComparability(base, makeRun({ config: { negativeTesting: { enabled: true, rate: 0.05 } } })).verdict, 'not_comparable');
  assert.equal(assessComparability(base, makeRun({ config: { thinkTime: { minMs: 100, maxMs: 300 } } })).verdict, 'caution');
  assert.equal(assessComparability(base, makeRun({ config: { scenarioWeights: { host_booking_flow: 400 } } })).verdict !== 'comparable', true);
  const reasons = assessComparability(base, makeRun({ config: { maxVus: 115 } })).reasons;
  assert.ok(reasons.some(r => r.field === 'maxVus' && r.baseline === 100 && r.current === 115));
});

test('small samples and a saturated load generator add a caution', () => {
  const base = makeRun();
  assert.equal(assessComparability(base, makeRun({ total: { requests: 600 } })).verdict, 'caution');
  assert.ok(assessComparability(base, makeRun({ total: { requests: 600 } })).reasons.some(r => r.field === 'sampleSize'));
  const saturated = makeRun(); saturated.generator = { saturated: true, evidence: [] };
  assert.ok(assessComparability(base, saturated).reasons.some(r => r.field === 'generatorSaturation'));
});

test('different commits and seeds are informational, not a reason to refuse the comparison', () => {
  const a = makeRun(); const b = makeRun({ seed: 'different-seed' }); b.build = { ...b.build, commit: 'b'.repeat(40) };
  const result = assessComparability(a, b);
  assert.equal(result.verdict, 'comparable');
  assert.ok(result.reasons.some(r => r.field === 'commit' && r.level === 'info')); assert.ok(result.reasons.some(r => r.field === 'seed' && r.level === 'info'));
});

test('throughput is only judged when load and error rates are comparable', () => {
  const base = makeRun(); // sustained 73.7 req/s at ~99.5 users
  const dropped = makeRun({ runId: 'run-20261002-100000-bbbb', top: { sustain: { seconds: 190, requests: 10000, failed: 10, rps: 52, errorRatePct: 0.1, latencyMs: base.total.latencyMs } } });
  assert.equal(class_(compareRuns(base, dropped), 'throughput'), 'potential_regression');
  const fewerUsers = makeRun({ runId: 'run-20261002-100000-cccc', top: { sustain: { seconds: 190, requests: 10000, failed: 10, rps: 52, errorRatePct: 0.1, latencyMs: base.total.latencyMs }, concurrency: { avgDuringSustain: 70, targetPeak: 100, achievedPeak: 100, minDuringSustain: 60, shortfallPct: 30 } } });
  const cmp = compareRuns(base, fewerUsers);
  assert.equal(class_(cmp, 'throughput'), 'inconclusive'); assert.match(metric(cmp, 'throughput').note, /concurrency differs/);
  const erroring = makeRun({ runId: 'run-20261002-100000-dddd', total: { errorRatePct: 4 }, top: { sustain: { seconds: 190, requests: 10000, failed: 400, rps: 52, errorRatePct: 4, latencyMs: base.total.latencyMs } } });
  assert.equal(class_(compareRuns(base, erroring), 'throughput'), 'inconclusive');
});

test('missing measurements are inconclusive, never a regression or an improvement', () => {
  const base = makeRun(); const current = makeRun({ runId: 'run-20261002-100000-bbbb' });
  current.total.timeoutRatePct = null; base.resources = null;
  const cmp = compareRuns(base, current);
  assert.equal(class_(cmp, 'timeoutRate'), 'inconclusive'); assert.match(metric(cmp, 'timeoutRate').note, /Not collected/);
  assert.deepEqual(cmp.resources, [], 'resource comparison needs both runs to have collected them');
});

test('endpoint, scenario and resource comparisons skip tiny samples and flag real changes', () => {
  const base = makeRun(); const current = makeRun({ runId: 'run-20261002-100000-bbbb' });
  current.endpoints = [{ ...current.endpoints[0], latencyMs: { ...current.endpoints[0].latencyMs, p95: 90 } }, { ...current.endpoints[1], requests: 10 }];
  current.resources.target.cpuPctOfOneCore.avg = 80;
  const cmp = compareRuns(base, current);
  assert.deepEqual(cmp.endpoints.map(e => e.name), ['GET /api/events'], 'POST /api/bookings has too few samples in the current run');
  assert.equal(cmp.endpoints[0].p95.classification, 'potential_regression');
  assert.equal(cmp.resources.find(r => r.id === 'targetCpu').classification, 'potential_regression');
  assert.equal(cmp.journeys.length, 1);
});

test('automatic baseline: latest earlier completed run in the same environment, preferring a fair comparison', () => {
  const current = makeRun({ runId: 'run-20261005-100000-eeee', startedAt: '2026-10-05T10:00:00.000Z' });
  const incomplete = makeRun({ runId: 'run-20261004-100000-dddd', startedAt: '2026-10-04T10:00:00.000Z' }); incomplete.complete = false; incomplete.state = 'cancelled';
  const different = makeRun({ runId: 'run-20261003-100000-cccc', startedAt: '2026-10-03T10:00:00.000Z', config: { maxVus: 400 } });
  const cautious = makeRun({ runId: 'run-20261002-100000-bbbb', startedAt: '2026-10-02T10:00:00.000Z', config: { maxVus: 115 } });
  const fair = makeRun({ runId: 'run-20261001-100000-aaaa', startedAt: '2026-10-01T10:00:00.000Z' });
  const later = makeRun({ runId: 'run-20261006-100000-ffff', startedAt: '2026-10-06T10:00:00.000Z' });
  const pick = findAutoBaseline(current, [later, incomplete, different, cautious, fair, current]);
  assert.equal(pick.run.runId, 'run-20261001-100000-aaaa'); assert.equal(pick.verdict, 'comparable');
  const onlyCautious = findAutoBaseline(current, [incomplete, different, cautious]);
  assert.equal(onlyCautious.run.runId, 'run-20261002-100000-bbbb'); assert.equal(onlyCautious.verdict, 'caution');
  assert.equal(findAutoBaseline(current, [incomplete, different, later]), null);
});

test('scenario distance is 0 for identical workloads and grows as traffic shifts', () => {
  const a = makeRun().config; const b = makeRun({ config: { scenarioWeights: { host_booking_flow: 300 } } }).config;
  assert.equal(scenarioDistance(a, a), 0); assert.ok(scenarioDistance(a, b) > 0.05);
});
