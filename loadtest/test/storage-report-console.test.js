// Storage safety, report generation and the console's authorization / cancellation / failure handling.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lt-test-'));
process.env.LOADTEST_DATA_DIR = dataDir;
process.env.LOADTEST_TOKEN = 'unit-test-token';
process.env.DB_NAME = 'eventplanningdb';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const storage = require('../lib/storage');
const { renderHtml, renderCsv } = require('../lib/report');
const { validateConfig } = require('../lib/config');
const { createApp } = require('../console/server');
const { makeRun } = require('./fixtures');

after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const config = () => validateConfig({}).config;

test('run ids are validated so a request cannot escape the data folder', () => {
  for (const bad of ['../../etc/passwd', 'run-1', 'run-20261001-100000-ZZZZ', '', 'run-20261001-100000-aaaa/../..']) assert.throws(() => storage.runDir(bad), /Invalid run id/, bad);
  assert.ok(storage.runDir('run-20261001-100000-ab12').startsWith(dataDir));
});

test('runs are created, updated, listed newest first, and active runs cannot be deleted', () => {
  const first = storage.createRun(config());
  storage.updateMeta(first.id, { state: 'completed' });
  const second = storage.createRun({ ...config(), name: 'second' });
  storage.updateMeta(second.id, { state: 'running' });
  assert.deepEqual(storage.listRuns().map(r => r.name).slice(0, 1), ['second']);
  assert.throws(() => storage.deleteRun(second.id), /still active/);
  assert.equal(storage.deleteRun(first.id), true);
  assert.equal(storage.readMeta(first.id), null);
  assert.equal(storage.deleteRun('run-20250101-000000-zzzz'.replace('zzzz', 'abcd')), false);
  storage.updateMeta(second.id, { state: 'failed' });
});

test('profiles accept safe names only', () => {
  storage.saveProfile('Nightly 100 users', { maxVus: 100 });
  assert.equal(storage.listProfiles()[0].name, 'Nightly 100 users');
  for (const bad of ['../x', 'a/b', '', 'x'.repeat(61)]) assert.throws(() => storage.saveProfile(bad, {}), /Profile names/);
  storage.deleteProfile('Nightly 100 users'); assert.deepEqual(storage.listProfiles(), []);
});

test('data cleanup refuses to touch the real application database', async () => {
  const { createDatabase, dropDatabase } = require('../worker/provision');
  await assert.rejects(createDatabase('eventplanningdb'), /Refusing to use the real database/);
  await assert.rejects(dropDatabase('eventplanningdb'), /Refusing to drop the real database/);
  await assert.rejects(createDatabase('bad name; DROP DATABASE x'), /Invalid database name/);
});

test('when the target API is unavailable, seeding fails fast with a clear error instead of hanging', async () => {
  const { seedData } = require('../worker/seed');
  const started = Date.now();
  await assert.rejects(seedData({ baseUrl: 'http://127.0.0.1:1', password: 'x', seed: 's', plan: { hosts: 1, vendors: 1, invitees: 1 }, eventsPerHost: 1 }), /fetch failed|ECONNREFUSED|connect/i);
  assert.ok(Date.now() - started < 8000);
  const { pollProbe } = require('../lib/monitors');
  assert.equal(await pollProbe('http://127.0.0.1:1/'), null, 'an unreachable probe means "not collected", not a made-up number');
  assert.equal(await pollProbe(undefined), null);
});

test('the HTML report escapes user text, shows every required section and never prints an unmeasured limit as passed', () => {
  const run = makeRun({ name: '<script>alert(1)</script>' });
  run.thresholds = [{ id: 'minRps', label: 'Throughput', unit: 'req/s', limit: 50, actual: null, status: 'not_measured', rule: 'at least 50 req/s' }, { id: 'p95Ms', label: 'p95 latency', unit: 'ms', limit: 800, actual: 900, status: 'fail', rule: 'at most 800 ms' }];
  run.thresholdStatus = 'fail';
  run.series = Array.from({ length: 60 }, (_, t) => ({ t, vus: t, requests: 5, failed: 0, timeouts: 0, avg: 10, p50: 8, p90: 20, p95: 30, p99: 50 }));
  const html = renderHtml(run, null);
  assert.ok(!html.includes('<script>alert(1)</script>') && html.includes('&lt;script&gt;'));
  for (const text of ['Load profile and achieved concurrency', 'Throughput, errors and latency over time', 'Thresholds', 'Bottleneck analysis', 'Workload: roles and scenarios', 'Endpoint performance', 'System resources', 'Top errors', 'Environment, build and reproducibility', 'Users are not requests per second', run.config.seed]) assert.ok(html.includes(text), `report mentions "${text}"`);
  assert.match(html, /Not measured/); assert.ok(!/<td class="warn">Passed/.test(html));
  assert.ok((html.match(/<svg/g) || []).length >= 4, 'charts are inline SVG');
  assert.ok(!/https?:\/\/(?!localhost)/.test(html.replace(/xmlns="[^"]*"/g, '')), 'no external assets');
});

test('the report includes the comparison section when a baseline exists', () => {
  const { compareRuns } = require('../lib/compare');
  const a = makeRun(); const b = makeRun({ runId: 'run-20261002-100000-bbbb', latency: { p95: 400 } });
  const html = renderHtml(b, compareRuns(a, b));
  assert.match(html, /Comparison with a previous run/); assert.match(html, /Potential regression/); assert.match(html, /\+33\.3%/);
});

test('CSV exports are well formed and escape quotes and commas', () => {
  const run = makeRun(); run.endpoints[0].name = 'GET /api/x?a=1,"b"';
  const csv = renderCsv('endpoints', run).split('\r\n');
  assert.equal(csv[0].split(',').length, 12); assert.ok(csv[1].startsWith('"GET /api/x?a=1,""b"""'));
  assert.ok(renderCsv('scenarios', run).includes('host_booking_flow')); assert.ok(renderCsv('summary', run).includes('threshold_p95Ms'));
  run.series = [{ t: 0, vus: 1, requests: 2, failed: 0, timeouts: 0, avg: 1, p50: 1, p90: 1, p95: 1, p99: 1 }];
  assert.equal(renderCsv('timeseries', run).split('\r\n').length, 2);
  assert.throws(() => renderCsv('nope', run), /Unknown CSV kind/);
});

// ------------------------------------------------------------------ console API
function request(server, method, urlPath, { token, body, host } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ host: '127.0.0.1', port: server.address().port, method, path: urlPath, headers: { Host: host || '127.0.0.1:5100', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) } }, res => {
      let text = ''; res.on('data', c => { text += c; }); res.on('end', () => { let json = null; try { json = JSON.parse(text); } catch (e) { /* not json */ } resolve({ status: res.statusCode, json, text }); });
    });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}
const listen = () => new Promise(resolve => { const server = createApp().listen(0, '127.0.0.1', () => resolve(server)); });

test('console: every API call needs the token and only our own host name is answered', async () => {
  const server = await listen();
  try {
    assert.equal((await request(server, 'GET', '/api/meta')).status, 401);
    assert.equal((await request(server, 'GET', '/api/meta', { token: 'wrong' })).status, 401);
    assert.equal((await request(server, 'POST', '/api/runs', { body: { config: {} } })).status, 401, 'cannot start a test without the token');
    assert.equal((await request(server, 'POST', '/api/runs/run-20261001-100000-aaaa/cancel')).status, 401, 'cannot cancel without the token');
    const meta = await request(server, 'GET', '/api/meta', { token: 'unit-test-token' });
    assert.equal(meta.status, 200); assert.ok(meta.json.limits.maxVus > 0); assert.ok(meta.json.environments.every(e => !e.production));
    assert.equal((await request(server, 'GET', '/api/meta', { token: 'unit-test-token', host: 'evil.example:5100' })).status, 403);
  } finally { server.close(); }
});

test('console: invalid, unconfirmed, over-limit and arbitrary-URL requests never start a run', async () => {
  const server = await listen();
  const before = storage.listRuns().length;
  try {
    const t = { token: 'unit-test-token' };
    const start = (cfg, confirm) => request(server, 'POST', '/api/runs', { ...t, body: { config: cfg, confirmEnvironment: confirm } });
    assert.equal((await start({}, undefined)).status, 400, 'no environment confirmation');
    assert.equal((await start({}, 'wrong-name')).status, 400);
    const overLimit = await start({ maxVus: 100000 }, 'managed-local'); assert.equal(overLimit.status, 400); assert.ok(overLimit.json.errors.some(e => /Maximum virtual users/.test(e)));
    assert.equal((await start({ durationSeconds: 999999 }, 'managed-local')).status, 400, 'no unbounded tests');
    const url = await start({ environment: 'http://169.254.169.254/latest' }, 'http://169.254.169.254/latest'); assert.equal(url.status, 400); assert.ok(url.json.errors.some(e => /Unknown environment/.test(e)), 'SSRF-style targets are refused');
    assert.equal((await request(server, 'POST', '/api/validate', { ...t, body: { config: { environment: 'prod' } } })).json.valid, false);
    assert.equal(storage.listRuns().length, before, 'nothing was created');
  } finally { server.close(); }
});

test('console: cancellation only works on active runs and uses a flag file the worker obeys', async () => {
  const server = await listen();
  try {
    const t = { token: 'unit-test-token' };
    const done = storage.createRun(config()); storage.updateMeta(done.id, { state: 'completed' });
    const cancelDone = await request(server, 'POST', `/api/runs/${done.id}/cancel`, t);
    assert.equal(cancelDone.status, 409); assert.match(cancelDone.json.message, /already completed/);
    const active = storage.createRun(config()); storage.updateMeta(active.id, { state: 'running', workerPid: process.pid });
    const ok = await request(server, 'POST', `/api/runs/${active.id}/cancel`, t);
    assert.equal(ok.status, 200); assert.ok(fs.existsSync(storage.reportPath(active.id, 'cancel.flag')));
    assert.equal((await request(server, 'DELETE', `/api/runs/${active.id}`, t)).status, 409, 'cannot delete a run that is still active');
    assert.equal((await request(server, 'GET', '/api/runs/not-a-run/live', t)).status, 400);
    assert.equal((await request(server, 'POST', '/api/runs/run-20261001-100000-abcd/cancel', t)).status, 404);
    storage.updateMeta(active.id, { state: 'cancelled' });
  } finally { server.close(); }
});

test('console: a run whose worker disappeared is marked failed instead of staying "running" forever', async () => {
  const server = await listen();
  try {
    const orphan = storage.createRun(config()); storage.updateMeta(orphan.id, { state: 'running', workerPid: 2147483000 });
    const runs = await request(server, 'GET', '/api/runs', { token: 'unit-test-token' });
    const found = runs.json.find(r => r.id === orphan.id);
    assert.equal(found.state, 'failed'); assert.match(found.stateReason, /ended unexpectedly/);
  } finally { server.close(); }
});

test('console: reports download in every format and the comparison endpoint uses stored results', async () => {
  const server = await listen();
  try {
    const t = { token: 'unit-test-token' };
    const a = makeRun({ runId: 'run-20261001-100000-aaaa' }); const b = makeRun({ runId: 'run-20261002-100000-bbbb', startedAt: '2026-10-02T10:00:00.000Z', latency: { p95: 420 } });
    for (const run of [a, b]) {
      storage.writeJson(path.join(storage.runDir(run.runId), 'meta.json'), { id: run.runId, name: run.name, state: 'completed', complete: true, createdAt: run.startedAt });
      storage.writeSummary(run.runId, run); storage.writeSeries(run.runId, { series: [], resources: [] });
    }
    assert.equal((await request(server, 'GET', `/api/runs/${b.runId}/report.json`, t)).status, 200);
    const csv = await request(server, 'GET', `/api/runs/${b.runId}/report.csv?kind=endpoints`, t); assert.equal(csv.status, 200); assert.match(csv.text, /^endpoint,requests/);
    const explicit = await request(server, 'GET', `/api/compare?baseline=${a.runId}&current=${b.runId}`, t);
    assert.equal(explicit.status, 200); assert.equal(explicit.json.metrics.find(m => m.id === 'p95').classification, 'potential_regression');
    const auto = await request(server, 'GET', `/api/compare?current=${b.runId}`, t); assert.equal(auto.json.baselineId, a.runId);
    const none = await request(server, 'GET', `/api/compare?current=${a.runId}`, t); assert.equal(none.json.none, true);
    assert.equal((await request(server, 'GET', '/api/compare?current=../../x', t)).status, 400);
  } finally { server.close(); }
});
