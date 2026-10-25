// Preloaded into the *managed test copy* of the Gather API (node -r probe-preload.js server.js) so the load test can
// read real server-side measurements. It does not change the application's code or behaviour; it only starts a tiny
// read-only HTTP endpoint on 127.0.0.1:LT_PROBE_PORT.
'use strict';
const http = require('node:http');
const path = require('node:path');
const { monitorEventLoopDelay } = require('node:perf_hooks');

const port = Number(process.env.LT_PROBE_PORT);
if (port) {
  const lag = monitorEventLoopDelay({ resolution: 10 });
  lag.enable();
  let lastCpu = process.cpuUsage();
  let lastAt = process.hrtime.bigint();
  let pool = null;
  const getPool = () => {
    if (!pool) { try { pool = require(path.join(process.cwd(), 'src/config/db')); } catch (error) { pool = false; } }
    return pool || null;
  };

  async function sample() {
    const now = process.hrtime.bigint();
    const cpu = process.cpuUsage();
    const wallMicros = Number(now - lastAt) / 1000;
    const cpuMicros = (cpu.user - lastCpu.user) + (cpu.system - lastCpu.system);
    lastCpu = cpu; lastAt = now;
    const memory = process.memoryUsage();
    const out = {
      time: Date.now(),
      cpuPct: wallMicros > 0 ? (cpuMicros / wallMicros) * 100 : null, // percent of ONE core
      rssMb: memory.rss / 1048576, heapUsedMb: memory.heapUsed / 1048576,
      eventLoopLagMs: { mean: lag.mean / 1e6, p99: lag.percentile(99) / 1e6, max: lag.max / 1e6 },
      pool: null, dbPingMs: null
    };
    lag.reset();
    const db = getPool();
    if (db && db.pool) {
      try {
        const core = db.pool;
        out.pool = { limit: core.config.connectionLimit, open: core._allConnections.length, idle: core._freeConnections.length, queued: core._connectionQueue.length };
        out.pool.inUse = out.pool.open - out.pool.idle;
      } catch (error) { out.pool = null; }
      const started = process.hrtime.bigint();
      try { await db.query('SELECT 1'); out.dbPingMs = Number(process.hrtime.bigint() - started) / 1e6; } catch (error) { out.dbPingMs = null; }
    }
    return out;
  }

  http.createServer((req, res) => {
    sample().then(data => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); })
      .catch(error => { res.statusCode = 500; res.end(JSON.stringify({ error: String(error.message) })); });
  }).listen(port, '127.0.0.1').unref();
}
