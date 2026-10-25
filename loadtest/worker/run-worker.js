// One load-test run, as its own process:  node loadtest/worker/run-worker.js <runId>
// Lifecycle: preparing (target + data) -> running -> ramping-down -> finalizing -> completed | failed | cancelled | aborted
// This process never serves the dashboard and never runs inside the Gather API, so neither can become the bottleneck.
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const readline = require('node:readline');
const { spawn, execFileSync } = require('node:child_process');

const storage = require('../lib/storage');
const { validateConfig, loadEnvironments } = require('../lib/config');
const { scenarioAvailability } = require('../lib/availability');
const { Aggregator } = require('../lib/aggregate');
const { ResourceCollector, SystemSampler, pollProbe, sampleProcess } = require('../lib/monitors');
const { evaluateThresholds, overallStatus } = require('../lib/thresholds');
const { concurrencyReport, generatorAssessment, bottlenecks } = require('../lib/analysis');
const { targetAt, stageAt } = require('../shared/stages');
const { provisionManaged } = require('./provision');
const { seedData } = require('./seed');
const { writeReports } = require('../lib/report');

const ROOT = path.join(__dirname, '../..');
const K6_BIN = process.env.K6_BIN || path.join(__dirname, '../tools/k6/k6.exe');
const runId = process.argv[2];
const log = message => { storage.appendLog(runId, message); };
class CancelledError extends Error {}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); });
    server.on('error', reject);
  });
}

function buildInfo() {
  const tryRun = (cmd, args) => { try { return execFileSync(cmd, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (error) { return null; } };
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  return { commit: tryRun('git', ['rev-parse', 'HEAD']), dirty: Boolean(tryRun('git', ['status', '--porcelain'])), appVersion: pkg.version, node: process.version,
    k6: (tryRun(K6_BIN, ['version']) || 'unknown').split('\n')[0] };
}

async function main() {
  const meta0 = storage.readMeta(runId);
  const rawConfig = storage.readConfig(runId);
  if (!meta0 || !rawConfig) throw new Error('Run definition not found');
  if (!fs.existsSync(K6_BIN)) throw new Error(`k6 is not installed. Run: node loadtest/tools/install-k6.js   (looked for ${K6_BIN})`);

  const environments = loadEnvironments();
  const { unavailable } = scenarioAvailability();
  const checked = validateConfig(rawConfig, { environments, unavailable });
  if (!checked.valid) throw new Error(`Configuration is no longer valid: ${checked.errors.join(' ')}`);
  const { config, plan } = checked;
  const environment = environments[config.environment];
  const build = buildInfo();
  const setState = (state, extra) => storage.updateMeta(runId, { state, ...(extra || {}) });
  const cancelFlag = storage.reportPath(runId, 'cancel.flag');

  let target = null;
  let k6 = null;
  let finalState = 'completed';
  let finalReason = null;
  const events = [];
  const note = message => { log(message); events.push({ at: Date.now(), message }); };
  const aggregator = new Aggregator(plan);
  let collector = null;
  const systemSampler = new SystemSampler();
  let startedAtMs = null;
  let killTimer = null;

  try {
    setState('preparing', { startedAt: new Date().toISOString(), workerPid: process.pid, build });
    note(`Run ${runId}: "${config.name}", seed ${config.seed}, ${plan.maxVus} users, ${plan.durationSeconds}s, environment ${config.environment}.`);

    if (environment.type !== 'managed') throw new Error(`Environment type "${environment.type}" is not supported by this worker. Only "managed" is implemented.`);
    const throwIfCancelled = () => { if (fs.existsSync(cancelFlag)) throw new CancelledError('cancelled by the user before the test started'); };
    throwIfCancelled();
    target = await provisionManaged(environment, note);
    throwIfCancelled();
    const password = `Lt-${crypto.randomBytes(9).toString('hex')}!A1`;
    note('Seeding isolated test accounts and records through the API...');
    const data = await seedData({ baseUrl: target.baseUrl, password, seed: config.seed, plan: checked.accounts, eventsPerHost: config.data.eventsPerHost, onLog: note });
    storage.writeData(runId, data);
    throwIfCancelled();
    note(`Test data ready: ${JSON.stringify(data.stats)}.`);
    storage.updateMeta(runId, { dataStats: data.stats, target: { baseUrl: target.baseUrl, database: target.database } });

    const apiPort = await freePort();
    const k6Env = { ...process.env, K6_NO_USAGE_REPORT: 'true', LT_CONFIG: JSON.stringify({ ...config, ...{ unavailable }, gracefulStopSeconds: plan.gracefulStopSeconds }),
      LT_BASE_URL: target.baseUrl, LT_PASSWORD: password, LT_DATA: storage.dataPath(runId) };
    k6 = spawn(K6_BIN, ['run', '--quiet', '--summary-mode', 'disabled', '--address', `127.0.0.1:${apiPort}`, '--out', 'json=-', path.join(__dirname, '../k6/main.js')], { cwd: ROOT, env: k6Env, stdio: ['ignore', 'pipe', 'pipe'] });
    startedAtMs = Date.now();
    collector = new ResourceCollector({ hasProbe: Boolean(target.probeUrl), generatorPid: k6.pid });
    setState('running', { k6StartedAt: new Date(startedAtMs).toISOString() });
    note(`k6 started (pid ${k6.pid}). Expected profile: ${plan.stages.map(s => `${s.name} ${s.durationSeconds}s`).join(', ')}.`);

    const reader = readline.createInterface({ input: k6.stdout });
    reader.on('line', line => aggregator.addLine(line));
    let stderrNotes = 0;
    readline.createInterface({ input: k6.stderr }).on('line', line => { if (line.trim() && stderrNotes < 40) { stderrNotes += 1; log(`k6: ${line.slice(0, 300)}`); } });
    const exit = new Promise(resolve => k6.on('close', (code, signal) => resolve({ code, signal })));

    const stopK6 = async reason => {
      if (finalReason) return;
      finalReason = reason;
      note(`Stopping the test: ${reason}`);
      try {
        await fetch(`http://127.0.0.1:${apiPort}/v1/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: { type: 'status', id: 'default', attributes: { stopped: true } } }) });
      } catch (error) { /* fall through to the kill timer */ }
      killTimer = setTimeout(() => { note('k6 did not stop gracefully; terminating it.'); try { k6.kill(); } catch (error) { /* gone */ } }, (plan.gracefulStopSeconds + 10) * 1000);
    };

    let abortStreak = 0;
    let busy = false;
    let finished = false;
    let latestResources = null;
    let tickCount = 0;
    const tick = async () => {
      if (busy || finished) return;
      busy = true;
      try {
        tickCount += 1;
        const elapsed = (Date.now() - startedAtMs) / 1000;
        const [probe, generatorReading] = await Promise.all([pollProbe(target.probeUrl), tickCount % 5 === 1 ? sampleProcess(k6.pid) : Promise.resolve(undefined)]);
        const system = systemSampler.sample();
        const generator = generatorReading === undefined ? (latestResources && latestResources.generator) : collector.generatorUsage(generatorReading, system.logicalCpus);
        latestResources = { system, target: probe, generator };
        collector.add(Math.round(elapsed), system, probe, generator);

        const snapshot = aggregator.snapshot(10);
        const state = storage.readMeta(runId).state;
        if (fs.existsSync(cancelFlag) && state !== 'cancelling') { setState('cancelling'); finalState = 'cancelled'; await stopK6('cancelled by the user'); }
        if (!finalReason && snapshot.rpsRecent > 0 && snapshot.errorRateRecentPct >= config.safety.abortErrorRatePct) abortStreak += 1; else abortStreak = 0;
        if (!finalReason && abortStreak >= config.safety.abortAfterSeconds) { finalState = 'aborted'; setState('cancelling'); await stopK6(`safety stop: error rate stayed at or above ${config.safety.abortErrorRatePct}% for ${config.safety.abortAfterSeconds}s`); }
        if (!finalReason && elapsed >= plan.sustainEndSeconds && state === 'running') setState('ramping-down');

        const live = { runId, plan, state: storage.readMeta(runId).state, elapsedSeconds: round1(elapsed), durationSeconds: plan.durationSeconds,
          remainingSeconds: Math.max(0, round1(plan.durationSeconds + 0 - elapsed)), stage: stageAt(plan, elapsed), targetVus: targetAt(plan, elapsed),
          ...snapshot, resources: latestResources, probeCollected: Boolean(probe),
          violations: evaluateThresholds({ ...config.thresholds, minRps: 0 }, { total: snapshot.total, sustain: null }).filter(t => t.status === 'fail'),
          generatorPid: k6.pid, abortStreak, log: storage.readLog(runId, 25), updatedAt: new Date().toISOString() };
        storage.writeLive(runId, live);
      } catch (error) { log(`monitor error: ${error.message}`); } finally { busy = false; }
    };
    const timer = setInterval(tick, 1000);
    const result = await exit;
    finished = true; clearInterval(timer); if (killTimer) clearTimeout(killTimer);
    if (result.code !== 0 && finalState === 'completed') { finalState = 'failed'; finalReason = `k6 exited with code ${result.code}${result.signal ? ` (${result.signal})` : ''}`; }
    note(`k6 finished (${finalState}${finalReason ? `: ${finalReason}` : ''}).`);
  } catch (error) {
    finalState = error instanceof CancelledError ? 'cancelled' : 'failed'; finalReason = error.message;
    note(`${finalState === 'cancelled' ? 'Run cancelled' : 'Run failed'}: ${error.message}`);
  }

  // ---- finalize -------------------------------------------------------------------------------------------------
  try {
    setState('finalizing');
    const endedAtMs = Date.now();
    const series = aggregator.series();
    const summary = aggregator.summary();
    const resources = collector ? collector.summary() : null;
    const thresholds = evaluateThresholds(config.thresholds, summary);
    const concurrency = series.length ? concurrencyReport(plan, series) : null;
    const wallSeconds = startedAtMs ? Math.round((endedAtMs - startedAtMs) / 1000) : 0;
    const complete = finalState === 'completed' && summary.activeSeconds >= plan.durationSeconds - 3;
    const full = {
      schema: 1, runId, name: config.name, state: finalState, stateReason: finalReason, complete,
      startedAt: meta0.createdAt && startedAtMs ? new Date(startedAtMs).toISOString() : null, endedAt: new Date(endedAtMs).toISOString(), wallSeconds,
      config, plan, environment: { key: config.environment, label: environment.label, type: environment.type, database: target && target.database },
      build, dataStrategy: { isolation: 'throw-away database copy', accounts: checked.accounts, eventsPerHost: config.data.eventsPerHost, maxCreatedPerUser: config.data.maxCreatedPerUser,
        writes: 'records are created through the API; journeys delete what they created beyond a per-user cap; the whole database is dropped after the run' },
      ...summary, concurrency, thresholds, thresholdStatus: overallStatus(thresholds), resources, unavailableScenarios: unavailable,
      generator: resources ? generatorAssessment(resources) : { saturated: null, evidence: ['No resource samples were collected.'] },
      bottlenecks: resources && series.length ? bottlenecks({ summary, series, resources, plan }) : []
    };
    full.targetSeries = collector ? collector.series() : [];
    storage.writeSummary(runId, { ...full, targetSeries: undefined });
    storage.writeSeries(runId, { series, resources: full.targetSeries });
    storage.updateMeta(runId, { state: finalState, stateReason: finalReason, endedAt: full.endedAt, complete, thresholdStatus: full.thresholdStatus,
      headline: { requests: summary.total.requests, avgRps: summary.avgRps, p95: summary.total.latencyMs.p95, errorRatePct: summary.total.errorRatePct, peakVus: summary.peakVus }, maxVus: plan.maxVus, durationSeconds: plan.durationSeconds });
    writeReports(runId);
    note(`Report written. Requests: ${summary.total.requests}, error rate ${summary.total.errorRatePct}%, p95 ${summary.total.latencyMs.p95} ms.`);
  } catch (error) {
    note(`Could not finalize the report: ${error.stack || error.message}`);
    storage.updateMeta(runId, { state: 'failed', stateReason: `finalize failed: ${error.message}`, endedAt: new Date().toISOString() });
  } finally {
    if (target) await target.stop();
    try { fs.rmSync(storage.reportPath(runId, 'cancel.flag'), { force: true }); } catch (error) { /* ignore */ }
    storage.prune({ keepLogs: require('../lib/config').loadLimits().logRetentionRuns, keepRuns: require('../lib/config').loadLimits().maxStoredRuns });
  }
}

function round1(n) { return Math.round(n * 10) / 10; }

main().then(() => process.exit(0)).catch(error => {
  try { storage.updateMeta(runId, { state: 'failed', stateReason: error.message, endedAt: new Date().toISOString() }); storage.appendLog(runId, `fatal: ${error.stack || error.message}`); } catch (e) { /* ignore */ }
  process.exit(1);
});
