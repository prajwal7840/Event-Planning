// Turns raw aggregates into conclusions that are backed by collected evidence: achieved concurrency, load-generator
// saturation, and likely bottlenecks. Every finding cites the numbers it is based on; with no evidence there is no finding.
'use strict';
const { round } = require('./aggregate');

const avg = list => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);

function concurrencyReport(plan, series) {
  const inSustain = series.filter(point => point.t >= plan.sustainStartSeconds && point.t < plan.sustainEndSeconds);
  const vus = inSustain.map(point => point.vus);
  const peak = series.reduce((m, p) => Math.max(m, p.vus), 0);
  const sustainAvg = vus.length ? round(avg(vus), 1) : null;
  return {
    targetPeak: plan.maxVus, achievedPeak: peak, avgDuringSustain: sustainAvg, minDuringSustain: vus.length ? Math.min(...vus) : null,
    shortfallPct: sustainAvg === null ? null : round(Math.max(0, ((plan.maxVus - sustainAvg) / plan.maxVus) * 100), 1)
  };
}

function generatorAssessment(resources) {
  const host = resources.loadGeneratorHost.cpuPct;
  const proc = resources.loadGeneratorProcess.cpuPctOfMachine;
  const target = resources.target && resources.target.cpuPctOfOneCore;
  const evidence = [];
  let saturated = null;
  if (host) {
    evidence.push(`Machine CPU: average ${host.avg}%, p95 ${host.p95}%, max ${host.max}%.`);
    saturated = host.p95 >= 90;
  }
  if (proc) evidence.push(`k6 process: average ${proc.avg}% of the machine, max ${proc.max}%.`);
  if (host && host.p95 >= 90 && target && target.p95 < 60) evidence.push(`The target API used only ${target.p95}% (p95) of one core while the machine was saturated, so the limit is most likely the machine or the load generator, not the API.`);
  if (host && host.p95 >= 90 && !target) evidence.push('Machine CPU is saturated and no target CPU is available, so load-generator limits cannot be separated from application limits.');
  if (!host) evidence.push('No machine CPU samples were collected.');
  return { saturated, evidence };
}

function findKnee(series, plan) {
  const usable = series.filter(p => p.p95 !== null && p.requests >= 3);
  const low = usable.filter(p => p.vus > 0 && p.vus <= Math.max(2, plan.maxVus * 0.2)).map(p => p.p95).sort((a, b) => a - b);
  if (low.length < 5) return null;
  const baseline = low[Math.floor(low.length / 2)];
  const limit = Math.max(baseline * 2, baseline + 200);
  for (let i = 0; i + 2 < usable.length; i += 1) {
    if (usable[i].p95 > limit && usable[i + 1].p95 > limit && usable[i + 2].p95 > limit) return { vus: usable[i].vus, atSecond: usable[i].t, baseline, p95: usable[i].p95 };
  }
  return null;
}

function findPlateau(series, plan) {
  if (plan.rampUpSeconds < 20) return null;
  const rampStart = plan.warmupSeconds; const rampEnd = plan.warmupSeconds + plan.rampUpSeconds;
  const from = rampEnd - Math.floor(plan.rampUpSeconds * 0.4);
  const mid = Math.floor((from + rampEnd) / 2);
  const slice = (a, b) => series.filter(p => p.t >= a && p.t < b);
  const first = slice(from, mid); const second = slice(mid, rampEnd);
  if (first.length < 4 || second.length < 4) return null;
  const v1 = avg(first.map(p => p.vus)); const v2 = avg(second.map(p => p.vus));
  const r1 = avg(first.map(p => p.requests)); const r2 = avg(second.map(p => p.requests));
  if (!v1 || !r1 || rampStart >= from) return null;
  if (v2 / v1 >= 1.2 && r2 / r1 < 1.05) return { vusBefore: round(v1, 0), vusAfter: round(v2, 0), rpsBefore: round(r1, 1), rpsAfter: round(r2, 1) };
  return null;
}

function bottlenecks({ summary, series, resources, plan }) {
  const findings = [];
  const add = (severity, title, evidence, explanation) => findings.push({ severity, title, evidence, explanation });
  const total = summary.total;
  if (!total.requests) { add('critical', 'No requests were recorded', ['k6 reported no completed requests.'], 'The test target may have been unreachable or the run stopped before sending traffic.'); return findings; }

  if (total.errorRatePct > 1) {
    const top = summary.topErrors.slice(0, 3).map(e => `${e.reason} (${e.count})`);
    add(total.errorRatePct > 5 ? 'critical' : 'warning', `Error rate ${total.errorRatePct}%`, [`${total.failed} of ${total.requests} requests failed unexpectedly.`, ...top.map(t => `Top cause: ${t}`)],
      'Failed requests are those whose status was not one of the outcomes the journey treats as correct. Fix the top causes before reading latency numbers.');
  }
  if (total.requests && total.rejections / total.requests > 0.05)
    add('info', 'Many business refusals', [`${total.rejections} requests (${round((total.rejections / total.requests) * 100, 1)}%) were expected refusals such as capacity or availability conflicts (HTTP 4xx).`], 'These are not errors, but they show the random workload frequently asks for impossible bookings; adjust the data pool if you want fewer.');

  const knee = findKnee(series, plan);
  if (knee) add('warning', `Latency rose sharply at about ${knee.vus} concurrent users`, [`p95 was ${knee.baseline} ms with few users and exceeded ${round(knee.p95, 0)} ms for 3 consecutive seconds from ${knee.atSecond}s (${knee.vus} users).`],
    'Latency that climbs with concurrency usually means a shared resource (CPU, database connections, locks) ran out of headroom near this level.');
  const plateau = findPlateau(series, plan);
  if (plateau) add('warning', 'Throughput stopped growing while users kept increasing', [`Users rose from ~${plateau.vusBefore} to ~${plateau.vusAfter} but requests per second moved from ${plateau.rpsBefore} to ${plateau.rpsAfter}.`],
    'Adding users no longer added throughput: the system (or the load generator) was at capacity, and extra users only waited longer.');

  const ranked = summary.endpoints.filter(e => e.requests >= 30 && e.latencyMs.p95 !== null);
  if (ranked.length) {
    const slow = [...ranked].sort((a, b) => b.latencyMs.p95 - a.latencyMs.p95).slice(0, 3);
    const timeShare = [...ranked].map(e => ({ name: e.name, share: e.requests * (e.latencyMs.avg || 0) })).sort((a, b) => b.share - a.share)[0];
    const overall = ranked.reduce((sum, e) => sum + e.requests * (e.latencyMs.avg || 0), 0);
    add('info', 'Slowest endpoints', [...slow.map(e => `${e.name}: p95 ${e.latencyMs.p95} ms over ${e.requests} requests`), `${timeShare.name} accounts for ${round((timeShare.share / overall) * 100, 0)}% of all time spent waiting on the server.`],
      'Start tuning here: these endpoints have the highest tail latency or consume the most total server time.');
  }

  const login = summary.endpoints.find(e => e.name === 'POST /api/auth/login');
  const lagMax = resources.target && resources.target.eventLoopLagP99Ms ? resources.target.eventLoopLagP99Ms.max : 0;
  if (login && login.requests >= 5 && login.latencyMs.p50 >= 100 && lagMax >= 100) {
    const others = summary.endpoints.filter(e => e.name !== 'POST /api/auth/login' && e.requests >= 30 && e.latencyMs.p50 !== null && e.latencyMs.p95 > Math.max(50, e.latencyMs.p50 * 10));
    add('warning', 'Password hashing at login stalls the API for other users',
      [`POST /api/auth/login median ${login.latencyMs.p50} ms over ${login.requests} logins.`, `Event-loop delay reached ${lagMax} ms.`,
        ...(others.length ? [`Fast endpoints show long tails: ${others.slice(0, 3).map(e => `${e.name} p50 ${e.latencyMs.p50} ms vs p95 ${e.latencyMs.p95} ms`).join('; ')}.`] : [])],
      'bcrypt checks are CPU-heavy and run on the same single thread that serves every other request, so each login delays all in-flight requests. Options: a native bcrypt build, hashing off the main thread, or a lower cost factor.');
  }
  const target = resources.target;
  if (target) {
    if (target.cpuPctOfOneCore && target.cpuPctOfOneCore.p95 >= 85) add('critical', 'API process CPU saturated', [`CPU of the API process: average ${target.cpuPctOfOneCore.avg}%, p95 ${target.cpuPctOfOneCore.p95}% of one core.`], 'Node.js runs JavaScript on one thread; near 100% of a core means requests queue for CPU time. Consider reducing per-request work, caching, or running several API processes.');
    if (target.eventLoopLagP99Ms && target.eventLoopLagP99Ms.p95 >= 100) add('warning', 'Event-loop lag', [`Event-loop delay p99 reached ${target.eventLoopLagP99Ms.max} ms (p95 of samples ${target.eventLoopLagP99Ms.p95} ms).`], 'The API\'s single thread was blocked long enough to delay every request; look for synchronous or CPU-heavy work such as password hashing.');
    if (target.dbPoolLimit && target.dbPoolInUse && (target.dbPoolInUse.p95 >= target.dbPoolLimit || (target.dbPoolQueued && target.dbPoolQueued.max > 0)))
      add('warning', 'Database connection pool exhausted', [`Pool limit ${target.dbPoolLimit}; in use p95 ${target.dbPoolInUse.p95}, max ${target.dbPoolInUse.max}; queued requests max ${target.dbPoolQueued ? target.dbPoolQueued.max : 'n/a'}.`], 'Requests waited for a free database connection. Raise the pool size only if MySQL has spare capacity; otherwise reduce query time.');
    if (target.dbRoundTripMs && target.dbRoundTripMs.p95 >= 50) add('warning', 'Slow database round-trip', [`A trivial SELECT 1 took p95 ${target.dbRoundTripMs.p95} ms (max ${target.dbRoundTripMs.max} ms).`], 'Even a no-op query was slow. The ping runs inside the API process, so a blocked event loop (see event-loop lag) inflates it; if lag is low, this points to database or connection-pool contention rather than one expensive query.');
  }

  const generator = generatorAssessment(resources);
  if (generator.saturated) add('warning', 'Load generator or machine may be saturated', generator.evidence, 'When the machine running k6 is out of CPU, measured latency includes the generator\'s own delays. Treat these results as a lower bound on capacity, or run the target and k6 on separate machines.');

  if (!findings.some(f => f.severity !== 'info')) add('info', 'No bottleneck evidence found', ['No error, saturation or latency-knee signal crossed its reporting level in the collected data.'], 'This does not prove there is headroom beyond the tested concurrency.');
  return findings;
}

module.exports = { concurrencyReport, generatorAssessment, bottlenecks, findKnee, findPlateau };
