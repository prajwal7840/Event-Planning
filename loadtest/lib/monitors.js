// Resource monitors. Only real measurements are recorded; anything without a real source stays null and is reported as
// "not collected".
'use strict';
const os = require('node:os');
const { execFile } = require('node:child_process');
const { Histogram } = require('./histogram');
const { round } = require('./aggregate');

class SystemSampler {
  constructor() { this.previous = this._read(); }
  _read() {
    return os.cpus().reduce((acc, cpu) => { const t = cpu.times; acc.idle += t.idle; acc.total += t.user + t.nice + t.sys + t.idle + t.irq; return acc; }, { idle: 0, total: 0 });
  }
  sample() {
    const now = this._read();
    const idle = now.idle - this.previous.idle; const total = now.total - this.previous.total;
    this.previous = now;
    return { cpuPct: total > 0 ? round((1 - idle / total) * 100, 1) : null, memUsedPct: round((1 - os.freemem() / os.totalmem()) * 100, 1), logicalCpus: os.cpus().length };
  }
}

async function pollProbe(url) {
  if (!url) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return response.ok ? await response.json() : null;
  } catch (error) { return null; }
}

// CPU and memory of one process (used for the k6 load generator), via PowerShell on Windows.
function sampleProcess(pid) {
  return new Promise(resolve => {
    if (process.platform !== 'win32' || !pid) return resolve(null);
    execFile('powershell', ['-NoProfile', '-Command', `$p = Get-Process -Id ${Number(pid)} -ErrorAction Stop; '{0} {1}' -f $p.TotalProcessorTime.TotalSeconds, $p.WorkingSet64`],
      { timeout: 4000, windowsHide: true }, (error, stdout) => {
        if (error) return resolve(null);
        const [cpu, ws] = String(stdout).trim().split(/\s+/).map(Number);
        resolve(Number.isFinite(cpu) ? { cpuSeconds: cpu, rssMb: ws / 1048576, at: Date.now() } : null);
      });
  });
}

class ResourceCollector {
  constructor({ hasProbe, generatorPid }) {
    this.hasProbe = Boolean(hasProbe);
    this.generatorPid = generatorPid || null;
    this.samples = [];
    this.lastGenerator = null;
    this.system = new SystemSampler();
  }
  add(t, system, target, generator) { this.samples.push({ t, system, target, generator }); }

  // Turns the CPU-seconds counter of the generator process into a percentage of the whole machine.
  generatorUsage(reading, logicalCpus) {
    if (!reading) return null;
    const previous = this.lastGenerator; this.lastGenerator = reading;
    if (!previous) return { cpuPctOfMachine: null, rssMb: round(reading.rssMb, 1) };
    const wall = (reading.at - previous.at) / 1000;
    return { cpuPctOfMachine: wall > 0 ? round(((reading.cpuSeconds - previous.cpuSeconds) / wall / logicalCpus) * 100, 1) : null, rssMb: round(reading.rssMb, 1) };
  }

  static stats(values) {
    const clean = values.filter(v => v !== null && v !== undefined && Number.isFinite(v));
    if (!clean.length) return null;
    const h = new Histogram(); clean.forEach(v => h.add(Math.max(v, 0)));
    return { samples: clean.length, avg: round(clean.reduce((a, b) => a + b, 0) / clean.length), p95: round(h.percentile(95)), max: round(Math.max(...clean)) };
  }

  summary() {
    const pick = (group, fn) => ResourceCollector.stats(this.samples.map(s => (s[group] ? fn(s[group]) : null)));
    return {
      loadGeneratorHost: { cpuPct: pick('system', s => s.cpuPct), memUsedPct: pick('system', s => s.memUsedPct), note: 'Whole machine. In the managed environment the target API, MySQL and k6 share it.' },
      loadGeneratorProcess: { cpuPctOfMachine: pick('generator', g => g.cpuPctOfMachine), rssMb: pick('generator', g => g.rssMb) },
      target: this.hasProbe ? {
        cpuPctOfOneCore: pick('target', t => t.cpuPct), rssMb: pick('target', t => t.rssMb), heapUsedMb: pick('target', t => t.heapUsedMb),
        eventLoopLagP99Ms: pick('target', t => t.eventLoopLagMs && t.eventLoopLagMs.p99), eventLoopLagMaxMs: pick('target', t => t.eventLoopLagMs && t.eventLoopLagMs.max),
        dbPoolInUse: pick('target', t => (t.pool ? t.pool.inUse : null)), dbPoolQueued: pick('target', t => (t.pool ? t.pool.queued : null)),
        dbPoolLimit: (this.samples.find(s => s.target && s.target.pool) || { target: { pool: {} } }).target.pool.limit || null,
        dbRoundTripMs: pick('target', t => t.dbPingMs)
      } : null,
      notCollected: [
        ...(this.hasProbe ? [] : ['Target CPU, memory, event-loop lag, DB pool usage and DB round-trip (no probe is attached to this environment)']),
        'MySQL server CPU and memory (no access to the database host metrics)',
        'Per-query database latency (no query log or performance_schema integration; only a SELECT 1 round-trip is measured)'
      ]
    };
  }

  series() {
    return this.samples.map(s => ({
      t: s.t, systemCpuPct: s.system ? s.system.cpuPct : null, systemMemPct: s.system ? s.system.memUsedPct : null,
      generatorCpuPct: s.generator ? s.generator.cpuPctOfMachine : null,
      targetCpuPct: s.target ? round(s.target.cpuPct, 1) : null, targetRssMb: s.target ? round(s.target.rssMb, 1) : null,
      lagP99Ms: s.target && s.target.eventLoopLagMs ? round(s.target.eventLoopLagMs.p99, 2) : null,
      poolInUse: s.target && s.target.pool ? s.target.pool.inUse : null, poolQueued: s.target && s.target.pool ? s.target.pool.queued : null,
      dbPingMs: s.target ? round(s.target.dbPingMs, 2) : null
    }));
  }
}

module.exports = { SystemSampler, ResourceCollector, pollProbe, sampleProcess };
