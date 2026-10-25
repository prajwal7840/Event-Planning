// Load-test console: dashboard + API for configuring, starting, monitoring, cancelling and comparing runs.
// Separate process from the Gather API. Binds to 127.0.0.1 only and requires an access token for every API call.
//   node loadtest/console/server.js        ->  http://127.0.0.1:5100
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const express = require('express');

const storage = require('../lib/storage');
const { validateConfig, defaultConfig, loadLimits, loadEnvironments, loadPresets } = require('../lib/config');
const { scenarioAvailability } = require('../lib/availability');
const { SCENARIOS } = require('../shared/catalog');
const { compareRuns, findAutoBaseline } = require('../lib/compare');
const { renderCsv, loadBundle, writeReports } = require('../lib/report');
const { reportPdf } = require('../lib/pdf');

const PORT = Number(process.env.LOADTEST_PORT || 5100);
const HOST = '127.0.0.1';
const K6_BIN = process.env.K6_BIN || path.join(__dirname, '../tools/k6/k6.exe');
const TOKEN_FILE = path.join(__dirname, '../.console-token');
const ACTIVE = ['queued', 'preparing', 'running', 'ramping-down', 'cancelling', 'finalizing'];

function loadToken() {
  if (process.env.LOADTEST_TOKEN) return process.env.LOADTEST_TOKEN;
  if (!fs.existsSync(TOKEN_FILE)) fs.writeFileSync(TOKEN_FILE, crypto.randomBytes(24).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(TOKEN_FILE, 'utf8').trim();
}
const TOKEN = loadToken();
const sameToken = candidate => { const a = Buffer.from(String(candidate || '')); const b = Buffer.from(TOKEN); return a.length === b.length && crypto.timingSafeEqual(a, b); };

const pidAlive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return false; } };
const k6Version = () => { try { return execFileSync(K6_BIN, ['version']).toString().trim().split('\n')[0]; } catch (error) { return null; } };

// A run whose worker process vanished (crash, machine restart) must not stay "running" forever.
function reconcile() {
  for (const meta of storage.listRuns()) {
    if (ACTIVE.includes(meta.state) && meta.workerPid && !pidAlive(meta.workerPid)) {
      storage.updateMeta(meta.id, { state: 'failed', stateReason: 'The worker process ended unexpectedly.', endedAt: new Date().toISOString() });
    } else if (meta.state === 'queued' && Date.now() - Date.parse(meta.createdAt) > 30000) {
      storage.updateMeta(meta.id, { state: 'failed', stateReason: 'The worker never started.', endedAt: new Date().toISOString() });
    }
  }
}
const activeRun = () => { reconcile(); return storage.listRuns().find(m => ACTIVE.includes(m.state)) || null; };

const recentStarts = [];
function createGuard(limits) {
  const now = Date.now();
  while (recentStarts.length && now - recentStarts[0] > 3600000) recentStarts.shift();
  if (recentStarts.length >= limits.maxRunsPerHour) return `At most ${limits.maxRunsPerHour} runs can be started per hour.`;
  if (recentStarts.length && now - recentStarts[recentStarts.length - 1] < limits.minSecondsBetweenRuns * 1000) return `Wait ${limits.minSecondsBetweenRuns} seconds between starting runs.`;
  return null;
}

const publicEnvironments = () => Object.entries(loadEnvironments()).map(([key, e]) => ({ key, label: e.label, description: e.description, type: e.type, enabled: e.enabled !== false, production: Boolean(e.production), allowWrites: e.allowWrites !== false }));

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => { // DNS-rebinding guard: only answer to our own host name
    const allowed = [`${HOST}:${PORT}`, `localhost:${PORT}`];
    if (!allowed.includes(String(req.headers.host))) return res.status(403).send('Forbidden host');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '200kb' }));
  app.use('/charts.js', (req, res) => res.type('js').sendFile(path.join(__dirname, '../shared/charts.js')));
  app.use(express.static(path.join(__dirname, 'public')));

  const api = express.Router();
  api.use((req, res, next) => {
    const header = String(req.headers.authorization || '');
    if (!sameToken(header.startsWith('Bearer ') ? header.slice(7) : req.headers['x-lt-token'])) return res.status(401).json({ message: 'Access token required. See loadtest/README.md.' });
    next();
  });
  const wrap = fn => (req, res) => Promise.resolve().then(() => fn(req, res)).catch(error => res.status(error.status || 500).json({ message: error.message }));
  const runParam = req => { if (!storage.RUN_ID.test(req.params.id)) { const e = new Error('Invalid run id'); e.status = 400; throw e; } return req.params.id; };

  api.get('/meta', wrap((req, res) => {
    const { unavailable } = scenarioAvailability();
    res.json({ limits: loadLimits(), environments: publicEnvironments(), presets: loadPresets(), defaults: defaultConfig(), profiles: storage.listProfiles(),
      scenarios: SCENARIOS.map(s => ({ id: s.id, role: s.role, category: s.category, label: s.label, description: s.description, defaultWeight: s.defaultWeight, unavailable: unavailable[s.id] || null })),
      engine: { name: 'k6', installed: fs.existsSync(K6_BIN), version: k6Version() }, activeRun: activeRun() });
  }));

  api.post('/validate', wrap((req, res) => {
    const { unavailable } = scenarioAvailability();
    const result = validateConfig(req.body && req.body.config, { unavailable });
    res.json({ valid: result.valid, errors: result.errors, warnings: result.warnings, config: result.config, plan: result.plan, preview: result.preview, accounts: result.accounts });
  }));

  api.post('/runs', wrap((req, res) => {
    const limits = loadLimits();
    const { unavailable } = scenarioAvailability();
    const result = validateConfig(req.body && req.body.config, { unavailable, requireConfirmation: true, confirmEnvironment: req.body && req.body.confirmEnvironment });
    if (!result.valid) return res.status(400).json({ message: 'Configuration is not valid.', errors: result.errors, warnings: result.warnings });
    if (!fs.existsSync(K6_BIN)) return res.status(409).json({ message: 'The k6 engine is not installed. Run: node loadtest/tools/install-k6.js' });
    if (activeRun()) return res.status(409).json({ message: 'A test is already running. Only one run can be active at a time.' });
    const blocked = createGuard(limits);
    if (blocked) return res.status(429).json({ message: blocked });
    const meta = storage.createRun(result.config, { createdBy: 'console' });
    recentStarts.push(Date.now());
    const out = fs.openSync(storage.reportPath(meta.id, 'worker.out'), 'a');
    const child = spawn(process.execPath, [path.join(__dirname, '../worker/run-worker.js'), meta.id], { detached: true, stdio: ['ignore', out, out], windowsHide: true });
    child.unref();
    storage.updateMeta(meta.id, { workerPid: child.pid });
    res.status(201).json({ id: meta.id });
  }));

  api.get('/runs', wrap((req, res) => { reconcile(); res.json(storage.listRuns()); }));

  api.get('/runs/:id', wrap((req, res) => {
    const id = runParam(req); reconcile();
    const meta = storage.readMeta(id);
    if (!meta) return res.status(404).json({ message: 'Run not found' });
    res.json({ meta, config: storage.readConfig(id), summary: storage.readSummary(id), log: storage.readLog(id, 300) });
  }));

  api.get('/runs/:id/live', wrap((req, res) => {
    const id = runParam(req); reconcile();
    const meta = storage.readMeta(id);
    if (!meta) return res.status(404).json({ message: 'Run not found' });
    res.json({ meta, live: ACTIVE.includes(meta.state) || meta.state === 'completed' ? storage.readLive(id) : storage.readLive(id), log: storage.readLog(id, 40) });
  }));

  api.post('/runs/:id/cancel', wrap((req, res) => {
    const id = runParam(req);
    const meta = storage.readMeta(id);
    if (!meta) return res.status(404).json({ message: 'Run not found' });
    if (!ACTIVE.includes(meta.state)) return res.status(409).json({ message: `The run is already ${meta.state}.` });
    fs.writeFileSync(storage.reportPath(id, 'cancel.flag'), new Date().toISOString());
    res.json({ message: 'Cancellation requested. The test stops gracefully and a partial report is written.' });
  }));

  api.delete('/runs/:id', wrap((req, res) => {
    const id = runParam(req);
    try { res.json({ deleted: storage.deleteRun(id) }); } catch (error) { res.status(409).json({ message: error.message }); }
  }));

  api.get('/runs/:id/report.html', wrap((req, res) => {
    const id = runParam(req);
    const file = storage.reportPath(id, 'report.html');
    if (!fs.existsSync(file)) return res.status(404).json({ message: 'No report yet' });
    res.type('html').sendFile(file);
  }));
  api.get('/runs/:id/report.json', wrap((req, res) => {
    const bundle = loadBundle(runParam(req));
    if (!bundle) return res.status(404).json({ message: 'No results yet' });
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.id}.json"`);
    res.json(bundle);
  }));
  api.get('/runs/:id/report.csv', wrap((req, res) => {
    const bundle = loadBundle(runParam(req));
    if (!bundle) return res.status(404).json({ message: 'No results yet' });
    const kind = ['summary', 'endpoints', 'scenarios', 'timeseries'].includes(req.query.kind) ? req.query.kind : 'summary';
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.id}-${kind}.csv"`);
    res.type('csv').send(renderCsv(kind, bundle));
  }));
  api.get('/runs/:id/report.pdf', wrap(async (req, res) => {
    const file = await reportPdf(runParam(req));
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.id}.pdf"`);
    res.type('pdf').sendFile(file);
  }));

  api.get('/compare', wrap((req, res) => {
    const load = id => { if (!storage.RUN_ID.test(String(id))) { const e = new Error('Invalid run id'); e.status = 400; throw e; } const s = storage.readSummary(id); if (!s) { const e = new Error(`Run ${id} has no results`); e.status = 404; throw e; } return s; };
    const current = load(req.query.current || req.query.auto);
    let baselineId = req.query.baseline;
    if (!baselineId) {
      const others = storage.listRuns().filter(m => m.id !== current.runId && m.state === 'completed' && m.complete).map(m => storage.readSummary(m.id)).filter(Boolean);
      const found = findAutoBaseline(current, others);
      if (!found) return res.json({ none: true, message: 'No earlier completed run in this environment is comparable with this one.' });
      baselineId = found.run.runId;
    }
    res.json(compareRuns(load(baselineId), current));
  }));

  api.post('/profiles', wrap((req, res) => {
    try { storage.saveProfile(String(req.body.name || ''), req.body.config || {}); res.status(201).json({ saved: true }); } catch (error) { res.status(400).json({ message: error.message }); }
  }));
  api.delete('/profiles/:name', wrap((req, res) => { try { storage.deleteProfile(req.params.name); res.json({ deleted: true }); } catch (error) { res.status(400).json({ message: error.message }); } }));

  api.post('/runs/:id/rebuild-report', wrap((req, res) => { writeReports(runParam(req)); res.json({ rebuilt: true }); }));

  app.use('/api', api);
  app.use('/api', (req, res) => res.status(404).json({ message: 'Not found' }));
  return app;
}

if (require.main === module) {
  reconcile();
  createApp().listen(PORT, HOST, () => {
    console.log(`Gather load-test console: http://${HOST}:${PORT}`);
    console.log(`Access token (also stored in ${path.relative(process.cwd(), TOKEN_FILE)}):\n  ${TOKEN}`);
    if (!fs.existsSync(K6_BIN)) console.log('k6 is not installed yet. Run: node loadtest/tools/install-k6.js');
  });
}

module.exports = { createApp, TOKEN, activeRun };
