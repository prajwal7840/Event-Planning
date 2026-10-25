// Consumes k6's JSON point stream and turns it into totals, per-endpoint / per-scenario / per-role statistics and a
// per-second time series. Only measurements k6 actually reports are recorded; nothing is estimated or invented.
'use strict';
const { Histogram } = require('./histogram');

const round = (value, digits = 2) => (value === null || value === undefined || !Number.isFinite(value) ? null : Math.round(value * 10 ** digits) / 10 ** digits);
const WANTED = ['"http_req_duration"', '"vus"', '"data_received"', '"data_sent"', '"lt_scenario_started"', '"lt_scenario_completed"',
  '"lt_scenario_failed"', '"lt_scenario_duration"', '"lt_journey_actions"', '"lt_negative_check"'];

function newGroup() { return { requests: 0, failed: 0, timeouts: 0, connectionErrors: 0, rejections: 0, bytesIn: 0, bytesOut: 0, hist: new Histogram(), statuses: {} }; }

class Aggregator {
  // plan: from shared/stages.planStages (used to isolate the sustained-load window)
  constructor(plan) {
    this.plan = plan || null;
    this.t0 = null; this.lastMs = null;
    this.total = newGroup();
    this.endpoints = new Map();
    this.journeys = new Map();
    this.roles = new Map();
    this.seconds = new Map();
    this.sustain = { requests: 0, failed: 0, hist: new Histogram(), seconds: new Set() };
    this.errorReasons = new Map();
    this.negativeChecks = 0;
    this.lines = 0; this.ignored = 0; this.maxVus = 0; this.lastVus = 0;
  }

  _group(map, key, extra) {
    let group = map.get(key);
    if (!group) { group = { ...newGroup(), started: 0, completed: 0, failedJourneys: 0, durationHist: new Histogram(), actionsSum: 0, actionsN: 0, ...(extra || {}) }; map.set(key, group); }
    return group;
  }

  _bucket(sec) {
    let bucket = this.seconds.get(sec);
    if (!bucket) {
      bucket = { requests: 0, failed: 0, timeouts: 0, rejections: 0, bytesIn: 0, hist: new Histogram(), vus: 0, final: null };
      this.seconds.set(sec, bucket);
      for (const [s, b] of this.seconds) if (s < sec - 70 && b.hist) { b.final = b.hist.stats(); b.hist = null; } // keep recent histograms only
    }
    return bucket;
  }

  addLine(line) {
    if (line.charCodeAt(0) !== 123 || line.indexOf('"type":"Point"') === -1) return;
    let wanted = false;
    for (const metric of WANTED) if (line.indexOf(metric) !== -1) { wanted = true; break; }
    if (!wanted) { this.ignored += 1; return; }
    let point;
    try { point = JSON.parse(line); } catch (error) { return; }
    this.lines += 1;
    const time = Date.parse(point.data.time);
    if (!Number.isFinite(time)) return;
    if (this.t0 === null) this.t0 = time;
    this.lastMs = Math.max(this.lastMs || 0, time);
    const sec = Math.max(0, Math.floor((time - this.t0) / 1000));
    const tags = point.data.tags || {};
    const value = point.data.value;
    switch (point.metric) {
      case 'http_req_duration': this._request(sec, value, tags); break;
      case 'vus': { const bucket = this._bucket(sec); bucket.vus = Math.max(bucket.vus, value); this.maxVus = Math.max(this.maxVus, value); this.lastVus = value; break; }
      case 'data_received': { const bytes = value || 0; this.total.bytesIn += bytes; if (tags.name) this._endpoint(tags.name, tags.method).bytesIn += bytes; this._bucket(sec).bytesIn += bytes; break; }
      case 'data_sent': { this.total.bytesOut += value || 0; if (tags.name) this._endpoint(tags.name, tags.method).bytesOut += value || 0; break; }
      case 'lt_scenario_started': this._scenario(tags).started += value; this._role(tags).started += value; break;
      case 'lt_scenario_completed': this._scenario(tags).completed += value; this._role(tags).completed += value; break;
      case 'lt_scenario_failed': this._scenario(tags).failedJourneys += value; this._role(tags).failedJourneys += value; break;
      case 'lt_scenario_duration': this._scenario(tags).durationHist.add(value); break;
      case 'lt_journey_actions': { const s = this._scenario(tags); s.actionsSum += value; s.actionsN += 1; break; }
      case 'lt_negative_check': this.negativeChecks += value; break;
      default: break;
    }
  }

  _endpoint(name, method) {
    let e = this.endpoints.get(name);
    if (!e) { e = { ...newGroup(), name, method: method || name.split(' ')[0] }; this.endpoints.set(name, e); }
    return e;
  }
  _scenario(tags) { return this._group(this.journeys, tags.journey || 'unknown', { role: tags.role }); }
  _role(tags) { return this._group(this.roles, tags.role || 'unknown'); }

  _request(sec, duration, tags) {
    const failed = tags.expected_response === 'false';
    const status = String(tags.status || '0');
    const errorText = String(tags.error || '');
    const timedOut = tags.error_code === '1050' || tags.error_code === '1210' || /timeout|deadline exceeded/i.test(errorText);
    const connectionError = failed && status === '0' && !timedOut;
    const rejection = !failed && Number(status) >= 400;
    const groups = [this.total, this._endpoint(tags.name || 'unknown', tags.method), this._scenario({ journey: tags.journey, role: tags.role }), this._role(tags)];
    for (const group of groups) {
      group.requests += 1; if (status !== '0') group.hist.add(duration);
      group.statuses[status] = (group.statuses[status] || 0) + 1;
      if (failed) group.failed += 1;
      if (timedOut) group.timeouts += 1;
      if (connectionError) group.connectionErrors += 1;
      if (rejection) group.rejections += 1;
    }
    const bucket = this._bucket(sec);
    bucket.requests += 1; if (failed) bucket.failed += 1; if (timedOut) bucket.timeouts += 1; if (rejection) bucket.rejections += 1;
    if (bucket.hist && status !== '0') bucket.hist.add(duration);
    if (this.plan && sec >= this.plan.sustainStartSeconds && sec < this.plan.sustainEndSeconds) {
      this.sustain.requests += 1; if (failed) this.sustain.failed += 1; if (status !== '0') this.sustain.hist.add(duration); this.sustain.seconds.add(sec);
    }
    if (failed) {
      const reason = `${tags.name || 'unknown'} -> ${status === '0' ? (errorText || 'connection error') : `HTTP ${status}`}`;
      this.errorReasons.set(reason, (this.errorReasons.get(reason) || 0) + 1);
    }
  }

  static groupSummary(group) {
    const stats = group.hist.stats();
    return {
      requests: group.requests, failed: group.failed, timeouts: group.timeouts, connectionErrors: group.connectionErrors, rejections: group.rejections,
      errorRatePct: group.requests ? round((group.failed / group.requests) * 100, 3) : null,
      timeoutRatePct: group.requests ? round((group.timeouts / group.requests) * 100, 3) : null,
      latencyMs: { avg: round(stats.avg), min: round(stats.min), p50: round(stats.p50), p90: round(stats.p90), p95: round(stats.p95), p99: round(stats.p99), max: round(stats.max) },
      statuses: group.statuses, bytesIn: group.bytesIn, bytesOut: group.bytesOut
    };
  }

  elapsedSeconds() { return this.t0 === null ? 0 : Math.max(0, (this.lastMs - this.t0) / 1000); }

  // Per-second series, ordered. Includes seconds with no requests so charts are not misleading.
  series() {
    const last = this.seconds.size ? Math.max(...this.seconds.keys()) : -1;
    const out = [];
    let carriedVus = 0;
    for (let sec = 0; sec <= last; sec += 1) {
      const bucket = this.seconds.get(sec);
      if (bucket && bucket.vus > 0) carriedVus = bucket.vus; // the vus gauge is sampled, not emitted every second
      const stats = bucket ? (bucket.hist ? bucket.hist.stats() : bucket.final) : null;
      out.push({
        t: sec, vus: carriedVus, requests: bucket ? bucket.requests : 0, failed: bucket ? bucket.failed : 0,
        timeouts: bucket ? bucket.timeouts : 0, rejections: bucket ? bucket.rejections : 0,
        avg: stats && stats.count ? round(stats.avg) : null, p50: stats && stats.count ? round(stats.p50) : null, p90: stats && stats.count ? round(stats.p90) : null,
        p95: stats && stats.count ? round(stats.p95) : null, p99: stats && stats.count ? round(stats.p99) : null,
        bytesIn: bucket ? bucket.bytesIn : 0
      });
    }
    return out;
  }

  // Live view: totals plus the last `windowSeconds` of completed seconds.
  snapshot(windowSeconds = 10) {
    const last = this.seconds.size ? Math.max(...this.seconds.keys()) : -1;
    const window = new Histogram();
    let requests = 0; let failed = 0; let spanned = 0;
    for (let sec = Math.max(0, last - windowSeconds); sec < last; sec += 1) { // skip the still-filling newest second
      const bucket = this.seconds.get(sec);
      if (!bucket) { spanned += 1; continue; }
      spanned += 1; requests += bucket.requests; failed += bucket.failed;
      if (bucket.hist) window.merge(bucket.hist);
    }
    const total = Aggregator.groupSummary(this.total);
    const w = window.stats();
    return {
      elapsedSeconds: round(this.elapsedSeconds(), 1), currentVus: this.lastVus, peakVus: this.maxVus,
      total, rpsRecent: spanned ? round(requests / spanned, 1) : 0, errorRateRecentPct: requests ? round((failed / requests) * 100, 2) : 0,
      latencyRecentMs: { avg: round(w.avg), p50: round(w.p50), p90: round(w.p90), p95: round(w.p95), p99: round(w.p99) },
      statuses: this.total.statuses,
      journeys: [...this.journeys.entries()].filter(([id]) => id !== 'session' && id !== 'idle' && id !== 'unknown').map(([id, g]) => ({ id, role: g.role, started: g.started, completed: g.completed, failed: g.failedJourneys })).sort((a, b) => b.started - a.started),
      endpoints: [...this.endpoints.values()].map(e => ({ name: e.name, requests: e.requests, failed: e.failed, p95: round(e.hist.percentile(95)), avg: round(e.hist.mean()) })).sort((a, b) => b.requests - a.requests).slice(0, 25),
      series: this.series().slice(-900)
    };
  }

  summary() {
    const total = Aggregator.groupSummary(this.total);
    const spanSeconds = Math.max(1, Math.round(this.elapsedSeconds()));
    const sustainStats = this.sustain.hist.stats();
    const sustainSeconds = this.sustain.seconds.size;
    return {
      total, activeSeconds: spanSeconds, avgRps: round(this.total.requests / spanSeconds, 2), peakVus: this.maxVus,
      sustain: sustainSeconds ? {
        seconds: sustainSeconds, requests: this.sustain.requests, failed: this.sustain.failed, rps: round(this.sustain.requests / sustainSeconds, 2),
        errorRatePct: this.sustain.requests ? round((this.sustain.failed / this.sustain.requests) * 100, 3) : null,
        latencyMs: { avg: round(sustainStats.avg), p50: round(sustainStats.p50), p90: round(sustainStats.p90), p95: round(sustainStats.p95), p99: round(sustainStats.p99) }
      } : null,
      endpoints: [...this.endpoints.values()].map(e => ({ name: e.name, method: e.method, ...Aggregator.groupSummary(e) })).sort((a, b) => b.requests - a.requests),
      journeys: [...this.journeys.entries()].filter(([id]) => id !== 'session' && id !== 'idle' && id !== 'unknown').map(([id, g]) => ({
        id, role: g.role, started: g.started, completed: g.completed, failed: g.failedJourneys,
        avgActions: g.actionsN ? round(g.actionsSum / g.actionsN, 1) : null,
        durationMs: { avg: round(g.durationHist.mean()), p50: round(g.durationHist.percentile(50)), p95: round(g.durationHist.percentile(95)) },
        requests: g.requests, failedRequests: g.failed, latencyMs: { p50: round(g.hist.percentile(50)), p95: round(g.hist.percentile(95)) }
      })).sort((a, b) => b.started - a.started),
      roles: [...this.roles.entries()].map(([role, g]) => ({ role, started: g.started, completed: g.completed, failedJourneys: g.failedJourneys, ...Aggregator.groupSummary(g) })),
      topErrors: [...this.errorReasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([reason, count]) => ({ reason, count })),
      negativeChecks: this.negativeChecks
    };
  }
}

module.exports = { Aggregator, round };
