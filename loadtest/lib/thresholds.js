// Evaluates configured performance thresholds against a run summary.
// A threshold whose measurement was not collected is "not_measured" and is never reported as passed.
'use strict';

const DEFINITIONS = [
  { id: 'p95Ms', label: 'p95 latency', unit: 'ms', compare: 'max', read: s => s.total && s.total.latencyMs.p95, enabled: v => v > 0 },
  { id: 'p99Ms', label: 'p99 latency', unit: 'ms', compare: 'max', read: s => s.total && s.total.latencyMs.p99, enabled: v => v > 0 },
  { id: 'errorRatePct', label: 'Error rate', unit: '%', compare: 'max', read: s => s.total && s.total.errorRatePct, enabled: v => v >= 0 },
  { id: 'timeoutRatePct', label: 'Timeout rate', unit: '%', compare: 'max', read: s => s.total && s.total.timeoutRatePct, enabled: v => v >= 0 },
  { id: 'minRps', label: 'Throughput during sustained load', unit: 'req/s', compare: 'min', read: s => (s.sustain ? s.sustain.rps : null), enabled: v => v > 0 }
];

// -> [{ id, label, unit, limit, actual, status: 'pass'|'fail'|'not_measured', rule }]
function evaluateThresholds(thresholds, summary) {
  const results = [];
  for (const def of DEFINITIONS) {
    const limit = Number(thresholds[def.id]);
    if (!Number.isFinite(limit) || !def.enabled(limit)) continue;
    const raw = summary ? def.read(summary) : null;
    const actual = raw === null || raw === undefined || !Number.isFinite(Number(raw)) || (summary.total && summary.total.requests === 0) ? null : Number(raw);
    let status = 'not_measured';
    if (actual !== null) status = (def.compare === 'max' ? actual <= limit : actual >= limit) ? 'pass' : 'fail';
    results.push({ id: def.id, label: def.label, unit: def.unit, limit, actual, status, rule: `${def.compare === 'max' ? 'at most' : 'at least'} ${limit} ${def.unit}` });
  }
  return results;
}

const overallStatus = results => (results.some(r => r.status === 'fail') ? 'fail' : results.some(r => r.status === 'not_measured') ? 'incomplete' : results.length ? 'pass' : 'none');

module.exports = { evaluateThresholds, overallStatus, DEFINITIONS };
