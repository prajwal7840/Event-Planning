// Load-test configuration: defaults, normalisation and validation against the safety limits.
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { SCENARIOS, defaultScenarioWeights } = require('../shared/catalog');
const { planStages, previewSeries } = require('../shared/stages');
const { ROLE_ORDER, mixTotal, eligibleScenarios } = require('../shared/weights');

const CONFIG_DIR = path.join(__dirname, '../config');
const readJson = name => JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, name), 'utf8'));
const loadLimits = () => readJson('limits.json');
const loadEnvironments = () => readJson('environments.json');
const loadPresets = () => readJson('presets.json');

function defaultConfig() {
  return {
    name: 'Gather load test',
    environment: 'managed-local',
    durationSeconds: 300,
    maxVus: 50,
    warmupSeconds: 15, warmupVus: 5,
    rampUpSeconds: 60,
    rampDownSeconds: 30,
    roleMix: { HOST: 50, VENDOR: 20, INVITEE: 30 },
    scenarioWeights: defaultScenarioWeights(),
    thinkTime: { minMs: 800, maxMs: 4000 },
    pacing: { minRequestGapMs: 100 },
    journey: { minActions: 2, maxActions: 6, earlyStopChance: 0.15 },
    negativeTesting: { enabled: false, rate: 0.05 },
    seed: '',
    thresholds: { p95Ms: 800, p99Ms: 2000, errorRatePct: 1, timeoutRatePct: 1, minRps: 0 },
    safety: { abortErrorRatePct: 50, abortAfterSeconds: 30 },
    data: { hosts: 0, vendors: 0, invitees: 0, eventsPerHost: 3, maxCreatedPerUser: 3 }, // 0 = derive from maxVus and role mix
    comparison: { autoBaseline: true, latencyPct: 10, errorRatePp: 0.5, throughputDropPct: 10, minAbsLatencyMs: 5, minSamples: 30 }
  };
}

const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
function deepMerge(base, extra) {
  if (!isObject(extra)) return base;
  const out = { ...base };
  for (const key of Object.keys(extra)) out[key] = isObject(base[key]) && isObject(extra[key]) ? deepMerge(base[key], extra[key]) : extra[key];
  return out;
}

function generateSeed() { return crypto.randomBytes(4).readUInt32BE(0).toString(36); }

// Accounts needed per role: enough that virtual users rarely share an account.
function accountPlan(config, limits) {
  const total = mixTotal(config.roleMix) || 100;
  const sizes = {};
  for (const [role, key] of [['HOST', 'hosts'], ['VENDOR', 'vendors'], ['INVITEE', 'invitees']]) {
    const share = (Number(config.roleMix[role]) || 0) / total;
    const configured = Number(config.data[key]) || 0;
    const needed = share > 0 ? Math.max(2, Math.ceil(config.maxVus * share) + 1) : 0;
    sizes[key] = Math.min(limits.maxAccountsPerRole, configured > 0 ? configured : needed);
  }
  return sizes;
}

// Returns { valid, errors[], warnings[], config, plan, preview, accounts, scenarios }.
// Pass `requireConfirmation` when actually starting a run.
function validateConfig(input, options = {}) {
  const limits = options.limits || loadLimits();
  const environments = options.environments || loadEnvironments();
  const unavailable = options.unavailable || {};
  const errors = [];
  const warnings = [];
  const config = deepMerge(defaultConfig(), isObject(input) ? input : {});
  if (!config.seed) config.seed = generateSeed();
  config.seed = String(config.seed).slice(0, 64);

  const num = (value, label, min, max, { integer = false } = {}) => {
    const n = Number(value);
    if (!Number.isFinite(n)) { errors.push(`${label} must be a number.`); return false; }
    if (integer && !Number.isInteger(n)) { errors.push(`${label} must be a whole number.`); return false; }
    if (n < min || n > max) { errors.push(`${label} must be between ${min} and ${max}.`); return false; }
    return true;
  };

  config.name = String(config.name || '').trim().slice(0, 80);
  if (!config.name) errors.push('Test name is required.');

  const environment = environments[config.environment];
  if (!environment) errors.push(`Unknown environment "${config.environment}". Only environments listed in loadtest/config/environments.json can be targeted.`);
  else {
    if (environment.enabled === false) errors.push(`Environment "${config.environment}" is disabled.`);
    if (environment.production) errors.push(`Environment "${config.environment}" is marked as production. Load tests against production are not supported.`);
    if (environment.allowWrites === false) errors.push(`Environment "${config.environment}" does not allow writes, but the workload creates and changes records.`);
  }
  if (options.requireConfirmation && !errors.length && config.environment !== options.confirmEnvironment)
    errors.push(`Confirm the target by typing the environment name "${config.environment}" before starting.`);

  const durationOk = num(config.durationSeconds, 'Duration (seconds)', limits.minDurationSeconds, limits.maxDurationSeconds, { integer: true });
  const vusOk = num(config.maxVus, 'Maximum virtual users', 1, limits.maxVus, { integer: true });
  num(config.warmupSeconds, 'Warm-up (seconds)', 0, limits.maxDurationSeconds, { integer: true });
  num(config.rampUpSeconds, 'Ramp-up (seconds)', 0, limits.maxDurationSeconds, { integer: true });
  num(config.rampDownSeconds, 'Ramp-down (seconds)', 0, limits.maxDurationSeconds, { integer: true });
  if (Number(config.warmupSeconds) > 0) num(config.warmupVus, 'Warm-up virtual users', 1, limits.maxVus, { integer: true });

  num(config.thinkTime.minMs, 'Think time minimum (ms)', 0, limits.maxThinkTimeMs);
  num(config.thinkTime.maxMs, 'Think time maximum (ms)', 0, limits.maxThinkTimeMs);
  if (Number(config.thinkTime.minMs) > Number(config.thinkTime.maxMs)) errors.push('Think time minimum cannot exceed the maximum.');
  num(config.pacing.minRequestGapMs, 'Minimum gap between requests (ms)', 0, 10000);
  num(config.journey.minActions, 'Minimum actions per journey', 1, 30, { integer: true });
  num(config.journey.maxActions, 'Maximum actions per journey', 1, 30, { integer: true });
  if (Number(config.journey.minActions) > Number(config.journey.maxActions)) errors.push('Minimum actions per journey cannot exceed the maximum.');
  num(config.journey.earlyStopChance, 'Early-stop chance', 0, 1);
  num(config.negativeTesting.rate, 'Negative-test rate', 0, 0.5);

  for (const [key, label, max] of [['p95Ms', 'p95 latency limit (ms)', 600000], ['p99Ms', 'p99 latency limit (ms)', 600000], ['errorRatePct', 'Error-rate limit (%)', 100], ['timeoutRatePct', 'Timeout-rate limit (%)', 100], ['minRps', 'Minimum throughput (req/s)', 1000000]])
    num(config.thresholds[key], label, 0, max);
  num(config.safety.abortErrorRatePct, 'Abort error rate (%)', 1, 100);
  num(config.safety.abortAfterSeconds, 'Abort after (seconds)', 5, 600);
  num(config.data.eventsPerHost, 'Events per host', 0, 20, { integer: true });
  num(config.data.maxCreatedPerUser, 'Maximum records created per user', 1, 20, { integer: true });
  for (const key of ['hosts', 'vendors', 'invitees']) num(config.data[key], `Number of ${key}`, 0, limits.maxAccountsPerRole, { integer: true });

  // role mix
  for (const role of ROLE_ORDER) num(config.roleMix[role], `${role} share (%)`, 0, 100);
  const total = mixTotal(config.roleMix);
  if (Math.abs(total - 100) > 0.5) errors.push(`Role distribution must add up to 100% (currently ${Math.round(total * 10) / 10}%).`);

  // scenario weights
  for (const scenario of SCENARIOS) {
    const weight = config.scenarioWeights[scenario.id];
    if (weight === undefined) config.scenarioWeights[scenario.id] = scenario.defaultWeight;
    else if (!(Number(weight) >= 0) || Number(weight) > 1000) errors.push(`Weight for "${scenario.id}" must be between 0 and 1000.`);
  }
  for (const role of ROLE_ORDER) {
    if ((Number(config.roleMix[role]) || 0) > 0 && !eligibleScenarios(SCENARIOS, role, config.scenarioWeights, unavailable).length)
      errors.push(`${role} users are configured but no ${role} scenario is available with a weight above 0.`);
  }
  const disabledWanted = SCENARIOS.filter(s => unavailable[s.id] && Number(config.scenarioWeights[s.id]) > 0);
  if (disabledWanted.length) warnings.push(`Unavailable scenarios will be skipped: ${disabledWanted.map(s => s.id).join(', ')}.`);

  let plan = null;
  let preview = [];
  if (durationOk && vusOk && !errors.some(e => /Warm-up|Ramp-/.test(e))) {
    plan = planStages(config);
    if (plan.sustainSeconds < 0) errors.push(`Warm-up + ramp-up + ramp-down (${plan.warmupSeconds + plan.rampUpSeconds + plan.rampDownSeconds}s) exceed the total duration (${plan.durationSeconds}s). Sustained load would be negative.`);
    else {
      preview = previewSeries(plan);
      if (plan.sustainSeconds === 0) warnings.push('No sustained-load period: the test goes straight from ramp-up to ramp-down, so throughput thresholds cannot be measured.');
      else if (plan.sustainSeconds < 10) warnings.push('Sustained load is under 10 seconds; steady-state numbers will be unreliable.');
      if (plan.maxVus >= 300) warnings.push('300+ virtual users on the same machine as the target can saturate the load generator; check the system-CPU readings in the report.');
    }
  }
  if (Number(config.thinkTime.maxMs) < 200 && !errors.length) warnings.push('Very short think time makes virtual users behave like request loops, not people.');
  if (config.negativeTesting.enabled) warnings.push('Negative testing is on: a share of requests are intentionally invalid and are expected to be rejected.');

  const accounts = accountPlan(config, limits);
  return { valid: errors.length === 0, errors, warnings, config, plan: errors.length ? (plan && plan.sustainSeconds >= 0 ? plan : null) : plan, preview, accounts, gracefulStopSeconds: limits.gracefulStopSeconds };
}

module.exports = { defaultConfig, validateConfig, deepMerge, loadLimits, loadEnvironments, loadPresets, accountPlan, generateSeed };
