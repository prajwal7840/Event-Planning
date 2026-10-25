// k6 runtime helpers: per-virtual-user state, tagged requests, pacing and custom metrics.
import http from 'k6/http';
import { sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import exec from 'k6/execution';

const { createRng } = require('../shared/prng.js');
const { roleForVu, eligibleScenarios } = require('../shared/weights.js');
const { SCENARIOS } = require('../shared/catalog.js');

export const CONFIG = JSON.parse(__ENV.LT_CONFIG);
export const BASE = __ENV.LT_BASE_URL;
const PASSWORD = __ENV.LT_PASSWORD;
export const DATA = JSON.parse(open(__ENV.LT_DATA));
const UNAVAILABLE = CONFIG.unavailable || {};

// Custom metrics. Request-level metrics (http_req_duration, ...) come from k6 itself, tagged below.
export const scenarioStarted = new Counter('lt_scenario_started');
export const scenarioCompleted = new Counter('lt_scenario_completed');
export const scenarioFailed = new Counter('lt_scenario_failed');
export const scenarioDuration = new Trend('lt_scenario_duration', true);
export const journeyActions = new Trend('lt_journey_actions');
export const rejections = new Counter('lt_rejection'); // expected business refusals (e.g. 409 capacity), not errors
export const negativeChecks = new Counter('lt_negative_check');

let state = null;

export function getVu() {
  if (state) return state;
  const id = exec.vu.idInTest;
  const role = roleForVu(id, CONFIG.roleMix, CONFIG.seed);
  const pool = DATA.accounts[role] || [];
  const account = pool.length ? pool[(id - 1) % pool.length] : null;
  state = {
    id, role, account,
    rng: createRng(CONFIG.seed, `vu:${id}`),
    token: null, headers: { 'Content-Type': 'application/json' },
    eligible: eligibleScenarios(SCENARIOS, role, CONFIG.scenarioWeights, UNAVAILABLE),
    lastRequestAt: 0, journey: 'session', journeyFailed: false, actionsRun: 0, iteration: 0,
    events: [], created: { events: [], expenses: [], slots: [] }, bookings: [], invitations: [], vendor: null
  };
  return state;
}

export function think(vu) {
  const t = CONFIG.thinkTime;
  if (t.maxMs > 0) sleep(vu.rng.float(t.minMs, t.maxMs) / 1000);
}

function pace(vu) {
  const gap = CONFIG.pacing.minRequestGapMs;
  const wait = vu.lastRequestAt + gap - Date.now();
  if (gap > 0 && wait > 0) sleep(wait / 1000);
}

// One tagged HTTP call. `name` is the endpoint template (low cardinality) used for per-endpoint statistics.
// `expected` lists status codes that are correct outcomes for this call (including business refusals like 409).
export function call(vu, name, method, path, body, expected, options) {
  pace(vu);
  const okStatuses = expected || [200];
  const params = {
    headers: vu.headers, timeout: '30s',
    tags: { name, journey: vu.journey, role: vu.role, ...(options && options.tags) },
    responseCallback: http.expectedStatuses(...okStatuses)
  };
  const res = http.request(method, BASE + path, body === undefined || body === null ? null : JSON.stringify(body), params);
  vu.lastRequestAt = Date.now();
  const ok = okStatuses.indexOf(res.status) !== -1;
  if (!ok) vu.journeyFailed = true;
  else if (res.status >= 400) rejections.add(1, { name, status: String(res.status), journey: vu.journey });
  return { res, ok, status: res.status, json() { try { return res.json(); } catch (e) { return null; } } };
}

export function login(vu) {
  if (!vu.account) return false;
  vu.journey = 'session';
  const result = call({ ...vu, headers: { 'Content-Type': 'application/json' } }, 'POST /api/auth/login', 'POST', '/api/auth/login', { email: vu.account.email, password: PASSWORD }, [200]);
  vu.lastRequestAt = Date.now();
  const data = result.ok ? result.json() : null;
  if (data && data.token) { vu.token = data.token; vu.headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${data.token}` }; return true; }
  vu.token = null;
  return false;
}

export function pad(n) { return n < 10 ? `0${n}` : String(n); }
export function formatDateTime(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}
export function parseDateTime(date, time) { return Date.parse(`${String(date).slice(0, 10)}T${String(time || '10:00:00').slice(0, 8)}Z`); }
export function randomDate(rng, year, monthMin, monthMax) {
  const month = rng.int(monthMin, monthMax);
  const day = rng.int(1, 28);
  return `${year}-${pad(month)}-${pad(day)}`;
}
export function query(params) {
  const parts = [];
  for (const key of Object.keys(params)) if (params[key] !== undefined && params[key] !== null && params[key] !== '') parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`);
  return parts.length ? `?${parts.join('&')}` : '';
}
