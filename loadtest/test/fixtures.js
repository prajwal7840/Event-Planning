// Synthetic run summaries for tests (same shape as loadtest/data/runs/<id>/summary.json).
const { validateConfig } = require('../lib/config');
const { evaluateThresholds, overallStatus } = require('../lib/thresholds');

function makeRun(over = {}) {
  const checked = validateConfig({ maxVus: 100, durationSeconds: 300, warmupSeconds: 20, rampUpSeconds: 60, rampDownSeconds: 30, seed: over.seed || 'fixture', ...(over.config || {}) });
  const latency = { avg: 40, min: 1, p50: 20, p90: 150, p95: 300, p99: 600, max: 900, ...(over.latency || {}) };
  const total = { requests: 20000, failed: 20, timeouts: 0, connectionErrors: 0, rejections: 100, errorRatePct: 0.1, timeoutRatePct: 0, latencyMs: latency, statuses: { 200: 19000, 201: 880, 409: 100, 500: 20 }, bytesIn: 5e6, bytesOut: 1e6, ...(over.total || {}) };
  const run = {
    runId: over.runId || 'run-20261001-100000-aaaa', name: over.name || 'fixture run', state: 'completed', complete: true, startedAt: over.startedAt || '2026-10-01T10:00:00.000Z', endedAt: '2026-10-01T10:05:30.000Z', wallSeconds: 330,
    config: checked.config, plan: checked.plan, environment: { key: 'managed-local', label: 'Managed', type: 'managed' }, build: { commit: 'a'.repeat(40), dirty: false, appVersion: '1.0.0', node: 'v24', k6: 'k6.exe v2.3.0' },
    dataStrategy: { accounts: { hosts: 51, vendors: 21, invitees: 31 }, eventsPerHost: 3, maxCreatedPerUser: 3, writes: 'test writes' },
    total, avgRps: 60, sustain: { seconds: 190, requests: 14000, failed: 10, rps: 73.7, errorRatePct: 0.07, latencyMs: latency }, peakVus: 100,
    endpoints: [{ name: 'GET /api/events', method: 'GET', requests: 5000, failed: 0, timeouts: 0, rejections: 0, errorRatePct: 0, timeoutRatePct: 0, latencyMs: { avg: 10, min: 1, p50: 8, p90: 20, p95: 30, p99: 60, max: 100 }, statuses: { 200: 5000 } },
      { name: 'POST /api/bookings', method: 'POST', requests: 900, failed: 5, timeouts: 0, rejections: 90, errorRatePct: 0.55, timeoutRatePct: 0, latencyMs: { avg: 50, min: 5, p50: 40, p90: 100, p95: 120, p99: 300, max: 500 }, statuses: { 201: 800, 409: 90, 500: 5 } }],
    journeys: [{ id: 'host_booking_flow', role: 'HOST', started: 300, completed: 295, failed: 5, avgActions: 4.1, durationMs: { avg: 9000, p50: 8000, p95: 15000 }, requests: 1200, failedRequests: 5, latencyMs: { p50: 30, p95: 150 } }],
    roles: [], topErrors: [{ reason: 'POST /api/bookings -> HTTP 500', count: 5 }], concurrency: { targetPeak: 100, achievedPeak: 100, avgDuringSustain: 99.5, minDuringSustain: 95, shortfallPct: 0.5 },
    resources: { loadGeneratorHost: { cpuPct: { samples: 300, avg: 40, p95: 60, max: 70 }, memUsedPct: { samples: 300, avg: 50, p95: 52, max: 55 } }, loadGeneratorProcess: { cpuPctOfMachine: { samples: 60, avg: 5, p95: 8, max: 9 }, rssMb: { samples: 60, avg: 100, p95: 120, max: 130 } },
      target: { cpuPctOfOneCore: { samples: 300, avg: 50, p95: 80, max: 95 }, rssMb: { samples: 300, avg: 150, p95: 170, max: 180 }, eventLoopLagP99Ms: { samples: 300, avg: 10, p95: 30, max: 90 }, dbPoolInUse: { samples: 300, avg: 3, p95: 6, max: 9 }, dbPoolQueued: { samples: 300, avg: 0, p95: 0, max: 0 }, dbPoolLimit: 10, dbRoundTripMs: { samples: 300, avg: 2, p95: 5, max: 20 } },
      notCollected: ['MySQL server CPU'] },
    unavailableScenarios: {}, generator: { saturated: false, evidence: [] }, bottlenecks: [], series: [], targetSeries: [], ...over.top
  };
  run.thresholds = evaluateThresholds(run.config.thresholds, run);
  run.thresholdStatus = overallStatus(run.thresholds);
  return run;
}

module.exports = { makeRun };
