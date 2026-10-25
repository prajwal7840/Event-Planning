// File-based store for run definitions, results and saved profiles. Deliberately separate from the application
// database: nothing here touches core Gather tables. Layout:
//   loadtest/data/runs/<runId>/{meta,config,summary,timeseries,live}.json, data.json, report.html, run.log
//   loadtest/data/profiles/<name>.json
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = process.env.LOADTEST_DATA_DIR || path.join(__dirname, '../data');
const RUN_ID = /^run-\d{8}-\d{6}-[a-z0-9]{4}$/;
const PROFILE_NAME = /^[A-Za-z0-9 _.-]{1,60}$/;

const runsDir = () => path.join(DATA_DIR, 'runs');
const profilesDir = () => path.join(DATA_DIR, 'profiles');

function runDir(id) {
  if (!RUN_ID.test(String(id))) throw new Error('Invalid run id');
  return path.join(runsDir(), id);
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value));
  for (let attempt = 0; ; attempt += 1) {
    try { fs.renameSync(temp, file); return; } catch (error) {
      if (attempt >= 5) { fs.copyFileSync(temp, file); fs.rmSync(temp, { force: true }); return; } // Windows: reader may hold the file
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
}
function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { return fallback; }
}

function newRunId(now = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `run-${stamp}-${crypto.randomBytes(2).toString('hex').slice(0, 4)}`;
}

function createRun(config, extra = {}) {
  const id = newRunId();
  const meta = { id, name: config.name, state: 'queued', createdAt: new Date().toISOString(), environment: config.environment, seed: config.seed, ...extra };
  writeJson(path.join(runDir(id), 'config.json'), config);
  writeJson(path.join(runDir(id), 'meta.json'), meta);
  return meta;
}

const readMeta = id => readJson(path.join(runDir(id), 'meta.json'));
function updateMeta(id, patch) {
  const meta = { ...(readMeta(id) || {}), ...patch };
  writeJson(path.join(runDir(id), 'meta.json'), meta);
  return meta;
}
const readConfig = id => readJson(path.join(runDir(id), 'config.json'));
const writeSummary = (id, summary) => writeJson(path.join(runDir(id), 'summary.json'), summary);
const readSummary = id => readJson(path.join(runDir(id), 'summary.json'));
const writeSeries = (id, series) => writeJson(path.join(runDir(id), 'timeseries.json'), series);
const readSeries = id => readJson(path.join(runDir(id), 'timeseries.json'));
const writeLive = (id, live) => writeJson(path.join(runDir(id), 'live.json'), live);
const readLive = id => readJson(path.join(runDir(id), 'live.json'));
const writeData = (id, data) => writeJson(path.join(runDir(id), 'data.json'), data);
const dataPath = id => path.join(runDir(id), 'data.json');
const reportPath = (id, name) => path.join(runDir(id), name);

function appendLog(id, message) {
  try { fs.appendFileSync(path.join(runDir(id), 'run.log'), `${new Date().toISOString()} ${message}\n`); } catch (error) { /* run folder removed */ }
}
const readLog = (id, lastLines = 200) => {
  try { return fs.readFileSync(path.join(runDir(id), 'run.log'), 'utf8').split('\n').filter(Boolean).slice(-lastLines); } catch (error) { return []; }
};

function listRuns() {
  if (!fs.existsSync(runsDir())) return [];
  return fs.readdirSync(runsDir()).filter(name => RUN_ID.test(name)).map(readMeta).filter(Boolean).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function deleteRun(id) {
  const meta = readMeta(id);
  if (!meta) return false;
  if (['queued', 'preparing', 'running', 'ramping-down', 'cancelling', 'finalizing'].includes(meta.state)) throw new Error('A run that is still active cannot be deleted');
  fs.rmSync(runDir(id), { recursive: true, force: true });
  return true;
}

// Keep the newest `keepLogs` run logs and the newest `keepRuns` runs; older heavy files are removed.
function prune({ keepLogs, keepRuns }) {
  const runs = listRuns();
  runs.slice(keepLogs).forEach(meta => fs.rmSync(path.join(runDir(meta.id), 'run.log'), { force: true }));
  runs.slice(keepRuns).filter(meta => !['running', 'preparing'].includes(meta.state)).forEach(meta => fs.rmSync(runDir(meta.id), { recursive: true, force: true }));
}

function saveProfile(name, config) {
  if (!PROFILE_NAME.test(name)) throw new Error('Profile names may use letters, numbers, spaces, dots, dashes and underscores (max 60).');
  writeJson(path.join(profilesDir(), `${name}.json`), { name, savedAt: new Date().toISOString(), config });
}
function listProfiles() {
  if (!fs.existsSync(profilesDir())) return [];
  return fs.readdirSync(profilesDir()).filter(file => file.endsWith('.json')).map(file => readJson(path.join(profilesDir(), file))).filter(Boolean);
}
function deleteProfile(name) {
  if (!PROFILE_NAME.test(name)) throw new Error('Invalid profile name');
  fs.rmSync(path.join(profilesDir(), `${name}.json`), { force: true });
}

module.exports = { DATA_DIR, RUN_ID, runDir, writeJson, readJson, newRunId, createRun, readMeta, updateMeta, readConfig, writeSummary, readSummary, writeSeries, readSeries,
  writeLive, readLive, writeData, dataPath, reportPath, appendLog, readLog, listRuns, deleteRun, prune, saveProfile, listProfiles, deleteProfile };
