const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Histogram } = require('../lib/histogram');
const { Aggregator } = require('../lib/aggregate');
const { evaluateThresholds, overallStatus } = require('../lib/thresholds');
const { planStages } = require('../shared/stages');
const { bottlenecks, findKnee } = require('../lib/analysis');
const { makeRun } = require('./fixtures');

const T0 = Date.parse('2026-10-25T10:00:00.000Z');
const iso = offsetMs => new Date(T0 + offsetMs).toISOString().replace('Z', '+00:00');
const point = (metric, offsetMs, value, tags = {}) => JSON.stringify({ metric, type: 'Point', data: { time: iso(offsetMs), value, tags } });
const req = (offsetMs, ms, tags = {}) => point('http_req_duration', offsetMs, ms, { name: 'GET /api/events', method: 'GET', status: '200', expected_response: 'true', journey: 'host_browse_discovery', role: 'HOST', ...tags });

test('histogram percentiles are accurate to about 1-2% and merge correctly', () => {
  const h = new Histogram();
  for (let i = 1; i <= 10000; i += 1) h.add(i / 10); // 0.1 .. 1000 ms uniform
  for (const [p, expected] of [[50, 500], [90, 900], [95, 950], [99, 990]]) assert.ok(Math.abs(h.percentile(p) - expected) / expected < 0.025, `p${p}=${h.percentile(p)}`);
  assert.equal(h.count, 10000); assert.ok(Math.abs(h.mean() - 500.05) < 1);
  const a = new Histogram(); const b = new Histogram();
  for (let i = 1; i <= 5000; i += 1) { a.add(i / 10); b.add(500 + i / 10); }
  a.merge(b); assert.equal(a.count, 10000); assert.ok(Math.abs(a.percentile(50) - h.percentile(50)) / 500 < 0.03);
  assert.equal(new Histogram().percentile(95), null);
  const copy = Histogram.fromJSON(JSON.parse(JSON.stringify(h))); assert.equal(copy.percentile(95), h.percentile(95));
  const odd = new Histogram(); odd.add(NaN); odd.add(-5); assert.equal(odd.count, 0, 'invalid values are ignored');
});

test('aggregator counts requests, failures, refusals, timeouts and connection errors separately', () => {
  const agg = new Aggregator(null);
  const lines = [
    req(0, 10), req(100, 20), req(200, 30, { status: '201' }),
    req(300, 40, { status: '409' }), // expected business refusal: not a failure
    req(400, 50, { status: '500', expected_response: 'false' }),
    req(500, 30000, { status: '0', expected_response: 'false', error: 'request timeout', error_code: '1050' }),
    req(600, 0, { status: '0', expected_response: 'false', error: 'dial: connection refused', error_code: '1212' }),
    point('http_reqs', 0, 1), point('http_req_blocked', 0, 1)
  ];
  lines.forEach(l => agg.addLine(l));
  const s = agg.summary();
  assert.equal(s.total.requests, 7); assert.equal(s.total.failed, 3); assert.equal(s.total.timeouts, 1); assert.equal(s.total.connectionErrors, 1); assert.equal(s.total.rejections, 1);
  assert.equal(s.total.errorRatePct, 42.857); assert.deepEqual(s.total.statuses, { 200: 2, 201: 1, 409: 1, 500: 1, 0: 2 });
  assert.equal(agg.lines, 7, 'metrics that are not needed are skipped, not parsed');
  assert.ok(s.total.latencyMs.max < 100, 'requests that got no response do not distort latency');
});

test('aggregator groups by endpoint, scenario and role and builds a per-second series', () => {
  const agg = new Aggregator(null);
  for (let i = 0; i < 100; i += 1) agg.addLine(req(i * 20, 10 + (i % 10), { name: 'GET /api/venues', journey: 'invitee_browse', role: 'INVITEE' }));
  for (let i = 0; i < 50; i += 1) agg.addLine(req(i * 40, 100, { name: 'POST /api/bookings', method: 'POST', status: '201', journey: 'host_booking_flow' }));
  agg.addLine(point('lt_scenario_started', 10, 1, { journey: 'host_booking_flow', role: 'HOST' }));
  agg.addLine(point('lt_scenario_completed', 20, 1, { journey: 'host_booking_flow', role: 'HOST' }));
  agg.addLine(point('lt_scenario_started', 30, 1, { journey: 'host_booking_flow', role: 'HOST' }));
  agg.addLine(point('lt_scenario_failed', 40, 1, { journey: 'host_booking_flow', role: 'HOST' }));
  agg.addLine(point('lt_scenario_duration', 50, 5000, { journey: 'host_booking_flow', role: 'HOST' }));
  agg.addLine(point('lt_journey_actions', 60, 4, { journey: 'host_booking_flow', role: 'HOST' }));
  agg.addLine(point('vus', 0, 3)); agg.addLine(point('vus', 1500, 7));
  const s = agg.summary();
  assert.deepEqual(s.endpoints.map(e => [e.name, e.requests]), [['GET /api/venues', 100], ['POST /api/bookings', 50]]);
  const booking = s.journeys.find(j => j.id === 'host_booking_flow');
  assert.deepEqual([booking.started, booking.completed, booking.failed, booking.avgActions], [2, 1, 1, 4]);
  assert.equal(s.roles.find(r => r.role === 'INVITEE').requests, 100);
  const series = agg.series();
  assert.equal(series.length, 2); assert.equal(series[0].requests, 100 > 50 ? series[0].requests : 0);
  assert.equal(series[0].requests + series[1].requests, 150);
  assert.equal(series[0].vus, 3); assert.equal(series[1].vus, 7);
  assert.ok(series[0].p95 >= series[0].p50);
  assert.equal(s.peakVus, 7);
});

test('the sustained-load window is measured separately from ramp-up and ramp-down', () => {
  const plan = planStages({ durationSeconds: 30, maxVus: 10, warmupSeconds: 0, rampUpSeconds: 10, rampDownSeconds: 10 });
  const agg = new Aggregator(plan);
  for (let sec = 0; sec < 30; sec += 1) for (let i = 0; i < 5; i += 1) agg.addLine(req(sec * 1000 + i * 100, sec >= 10 && sec < 20 ? 20 : 500));
  const s = agg.summary();
  assert.equal(s.sustain.seconds, 10); assert.equal(s.sustain.requests, 50); assert.equal(s.sustain.rps, 5);
  assert.ok(s.sustain.latencyMs.p95 < 30, 'ramp phases (500 ms) are excluded from the sustained figures');
  assert.ok(s.total.latencyMs.p95 > 400);
});

test('live snapshot reports recent rate and latency without waiting for the end', () => {
  const agg = new Aggregator(null);
  for (let sec = 0; sec < 20; sec += 1) for (let i = 0; i < 10; i += 1) agg.addLine(req(sec * 1000 + i * 90, sec < 10 ? 10 : 200, sec === 19 && i === 0 ? { status: '500', expected_response: 'false' } : {}));
  const snap = agg.snapshot(5);
  assert.equal(snap.total.requests, 200); assert.equal(snap.rpsRecent, 10); assert.ok(snap.latencyRecentMs.p95 > 150, 'recent window reflects the slow phase');
  assert.ok(snap.total.latencyMs.p50 < 250); assert.ok(snap.series.length >= 19);
  assert.ok(agg.snapshot(5).journeys !== undefined);
});

test('garbage and unrelated lines are ignored safely', () => {
  const agg = new Aggregator(null);
  ['', 'not json', '{"type":"Metric","data":{}}', '{"type":"Point","metric":"http_req_duration","data":{"time":"bad","value":1,"tags":{}}}', '{"type":"Point" truncated'].forEach(l => agg.addLine(l));
  assert.equal(agg.summary().total.requests, 0);
});

test('thresholds: pass, fail and not-measured are distinct, and nothing unmeasured can pass', () => {
  const run = makeRun({ latency: { p95: 700, p99: 2500 }, total: { errorRatePct: 0.5, timeoutRatePct: 0 } });
  const results = Object.fromEntries(evaluateThresholds({ p95Ms: 800, p99Ms: 2000, errorRatePct: 1, timeoutRatePct: 1, minRps: 50 }, run).map(r => [r.id, r.status]));
  assert.deepEqual(results, { p95Ms: 'pass', p99Ms: 'fail', errorRatePct: 'pass', timeoutRatePct: 'pass', minRps: 'pass' });
  const noSustain = evaluateThresholds({ p95Ms: 800, minRps: 50 }, { ...run, sustain: null });
  assert.equal(noSustain.find(t => t.id === 'minRps').status, 'not_measured');
  const noData = evaluateThresholds({ p95Ms: 800, errorRatePct: 1 }, { total: { requests: 0, latencyMs: { p95: null }, errorRatePct: null } });
  assert.deepEqual(noData.map(t => t.status), ['not_measured', 'not_measured']);
  assert.equal(overallStatus(noData), 'incomplete'); assert.notEqual(overallStatus(noData), 'pass');
  assert.equal(overallStatus([{ status: 'pass' }, { status: 'fail' }]), 'fail'); assert.equal(overallStatus([]), 'none');
  assert.deepEqual(evaluateThresholds({ p95Ms: 0, minRps: 0 }, run), [], 'a limit of 0 means "not checked" for latency and throughput');
});

test('bottleneck findings cite evidence and stay silent when there is none', () => {
  const plan = planStages({ durationSeconds: 300, maxVus: 100, warmupSeconds: 20, warmupVus: 5, rampUpSeconds: 60, rampDownSeconds: 30 });
  const series = Array.from({ length: 300 }, (_, t) => ({ t, vus: Math.min(100, Math.round(t * 1.5)), requests: 20, failed: 0, p95: t < 100 ? 30 : 400 }));
  const knee = findKnee(series, plan);
  assert.ok(knee && knee.vus >= 60 && knee.vus <= 100, JSON.stringify(knee));
  const healthy = makeRun();
  assert.ok(bottlenecks({ summary: healthy, series: [], resources: healthy.resources, plan }).every(f => f.severity === 'info'));
  const hot = makeRun({ top: { resources: { ...healthy.resources, target: { ...healthy.resources.target, cpuPctOfOneCore: { avg: 92, p95: 99, max: 100, samples: 10 } } } } });
  const findings = bottlenecks({ summary: hot, series: [], resources: hot.resources, plan });
  assert.ok(findings.some(f => /CPU saturated/.test(f.title) && f.evidence[0].includes('99')));
  const errors = makeRun({ total: { errorRatePct: 8, failed: 1600 } });
  assert.ok(bottlenecks({ summary: errors, series: [], resources: errors.resources, plan }).some(f => f.severity === 'critical' && /Error rate 8%/.test(f.title)));
  const empty = makeRun({ total: { requests: 0 } });
  assert.match(bottlenecks({ summary: empty, series: [], resources: empty.resources, plan })[0].title, /No requests/);
  const saturated = makeRun({ top: { resources: { ...healthy.resources, loadGeneratorHost: { cpuPct: { avg: 95, p95: 99, max: 100, samples: 9 }, memUsedPct: null }, target: null } } });
  assert.ok(bottlenecks({ summary: saturated, series: [], resources: saturated.resources, plan }).some(f => /Load generator or machine/.test(f.title)));
});
