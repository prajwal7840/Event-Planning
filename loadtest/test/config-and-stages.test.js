const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateConfig, defaultConfig, accountPlan, loadLimits, loadPresets } = require('../lib/config');
const { planStages, targetAt, k6Stages, previewSeries, stageAt } = require('../shared/stages');
const { scenarioAvailability, declaredRoutes } = require('../lib/availability');
const { SCENARIOS } = require('../shared/catalog');

const valid = over => validateConfig({ ...over });

test('a default configuration is valid and reports the expected load progression', () => {
  const result = valid({});
  assert.equal(result.valid, true, result.errors.join('; '));
  assert.ok(result.plan.stages.length >= 3);
  assert.equal(result.preview.at(-1)[1], 0, 'ends at zero users');
  assert.match(result.config.seed, /^[a-z0-9]+$/, 'a seed is generated when none is given');
});

test('every shipped preset is valid within the safety limits', () => {
  for (const [key, preset] of Object.entries(loadPresets())) assert.equal(valid(preset.config).valid, true, `${key}: ${valid(preset.config).errors.join('; ')}`);
});

test('duration and concurrency are bounded by the configured limits', () => {
  const limits = loadLimits();
  assert.equal(valid({ durationSeconds: limits.maxDurationSeconds + 1 }).valid, false);
  assert.equal(valid({ durationSeconds: limits.minDurationSeconds - 1 }).valid, false);
  assert.equal(valid({ maxVus: limits.maxVus + 1 }).valid, false);
  assert.equal(valid({ maxVus: 0 }).valid, false);
  assert.equal(valid({ maxVus: 2.5 }).valid, false);
  assert.equal(valid({ durationSeconds: 'abc' }).valid, false);
  assert.equal(valid({ durationSeconds: limits.maxDurationSeconds, maxVus: limits.maxVus }).valid, true, 'the limits themselves are allowed');
});

test('role distribution must total 100% and every used role needs an available scenario', () => {
  assert.match(valid({ roleMix: { HOST: 50, VENDOR: 50, INVITEE: 50 } }).errors.join(' '), /100%/);
  assert.equal(valid({ roleMix: { HOST: 100, VENDOR: 0, INVITEE: 0 } }).valid, true);
  const noVendorWeights = Object.fromEntries(SCENARIOS.filter(s => s.role === 'VENDOR').map(s => [s.id, 0]));
  assert.match(valid({ scenarioWeights: noVendorWeights }).errors.join(' '), /VENDOR users are configured but no VENDOR scenario/);
  assert.equal(valid({ roleMix: { HOST: 70, VENDOR: 0, INVITEE: 30 }, scenarioWeights: noVendorWeights }).valid, true, 'unused role may have no scenarios');
  assert.equal(valid({ scenarioWeights: { host_browse_discovery: -1 } }).valid, false);
});

test('stages that do not fit in the duration are rejected, not silently clipped', () => {
  const result = valid({ durationSeconds: 60, warmupSeconds: 30, rampUpSeconds: 30, rampDownSeconds: 30 });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /exceed the total duration/);
});

test('warnings explain risky but allowed settings', () => {
  assert.match(valid({ durationSeconds: 60, warmupSeconds: 0, rampUpSeconds: 30, rampDownSeconds: 30 }).warnings.join(' '), /No sustained-load/);
  assert.match(valid({ negativeTesting: { enabled: true, rate: 0.1 } }).warnings.join(' '), /Negative testing is on/);
  assert.match(valid({ maxVus: 400 }).warnings.join(' '), /saturate the load generator/);
});

test('only named environments can be targeted; arbitrary URLs, unknown names and production are refused', () => {
  assert.equal(valid({ environment: 'http://example.com' }).valid, false);
  assert.match(valid({ environment: 'https://evil.test/' }).errors.join(' '), /Unknown environment/);
  const environments = { prod: { enabled: true, production: true, allowWrites: true }, ro: { enabled: true, allowWrites: false }, off: { enabled: false } };
  assert.match(validateConfig({ environment: 'prod' }, { environments }).errors.join(' '), /production/);
  assert.match(validateConfig({ environment: 'ro' }, { environments }).errors.join(' '), /does not allow writes/);
  assert.match(validateConfig({ environment: 'off' }, { environments }).errors.join(' '), /disabled/);
});

test('starting requires typing the environment name', () => {
  assert.equal(validateConfig({}, { requireConfirmation: true, confirmEnvironment: 'managed-local' }).valid, true);
  assert.match(validateConfig({}, { requireConfirmation: true, confirmEnvironment: 'wrong' }).errors.join(' '), /Confirm the target/);
  assert.match(validateConfig({}, { requireConfirmation: true }).errors.join(' '), /Confirm the target/);
});

test('think time, pacing and thresholds are validated', () => {
  assert.equal(valid({ thinkTime: { minMs: 5000, maxMs: 1000 } }).valid, false);
  assert.equal(valid({ journey: { minActions: 5, maxActions: 2 } }).valid, false);
  assert.equal(valid({ thresholds: { p95Ms: 'fast' } }).valid, false);
  assert.equal(valid({ safety: { abortErrorRatePct: 0 } }).valid, false);
  assert.equal(valid({ negativeTesting: { enabled: true, rate: 0.9 } }).valid, false);
});

test('account pools scale with users and role mix, capped by the limit', () => {
  const limits = loadLimits();
  const config = { ...defaultConfig(), maxVus: 100, roleMix: { HOST: 50, VENDOR: 20, INVITEE: 30 } };
  assert.deepEqual(accountPlan(config, limits), { hosts: 51, vendors: 21, invitees: 31 });
  assert.equal(accountPlan({ ...config, maxVus: 1000, roleMix: { HOST: 100, VENDOR: 0, INVITEE: 0 } }, limits).hosts, limits.maxAccountsPerRole);
  assert.equal(accountPlan({ ...config, roleMix: { HOST: 100, VENDOR: 0, INVITEE: 0 } }, limits).vendors, 0, 'unused roles get no accounts');
  assert.equal(accountPlan({ ...config, data: { ...config.data, hosts: 7 } }, limits).hosts, 7, 'explicit sizes win');
});

test('stage plan: duration = warm-up + ramp-up + sustain + ramp-down, and targets follow the profile', () => {
  const plan = planStages({ durationSeconds: 300, maxVus: 100, warmupSeconds: 20, warmupVus: 5, rampUpSeconds: 60, rampDownSeconds: 30 });
  assert.equal(plan.sustainSeconds, 190);
  assert.equal(plan.stages.reduce((sum, s) => sum + s.durationSeconds, 0), 300);
  assert.deepEqual(plan.stages.map(s => s.name), ['warm-up', 'ramp-up', 'sustained load', 'ramp-down']);
  assert.equal(targetAt(plan, 0), 0);
  assert.equal(targetAt(plan, 20), 5);
  assert.equal(targetAt(plan, 50), 53, 'halfway up the ramp');
  assert.equal(targetAt(plan, 80), 100);
  assert.equal(targetAt(plan, 200), 100);
  assert.equal(targetAt(plan, 285), 50, 'halfway down');
  assert.equal(targetAt(plan, 300), 0);
  assert.equal(targetAt(plan, 999), 0);
  assert.equal(stageAt(plan, 10), 'warm-up'); assert.equal(stageAt(plan, 100), 'sustained load'); assert.equal(stageAt(plan, 301), 'finished');
  assert.deepEqual(k6Stages(plan).map(s => s.duration), ['20s', '60s', '190s', '30s']);
  assert.deepEqual(k6Stages(plan).map(s => s.target), [5, 100, 100, 0]);
  assert.equal(previewSeries(plan, 60).length, 61);
});

test('stage plan without warm-up or ramp-down skips those stages', () => {
  const plan = planStages({ durationSeconds: 100, maxVus: 10, warmupSeconds: 0, rampUpSeconds: 40, rampDownSeconds: 0 });
  assert.deepEqual(plan.stages.map(s => s.name), ['ramp-up', 'sustained load']);
  assert.equal(plan.stages[0].fromVus, 0);
  assert.equal(plan.sustainStartSeconds, 40); assert.equal(plan.sustainEndSeconds, 100);
});

test('scenarios depend on routes that really exist in this repository', () => {
  const { unavailable, routes } = scenarioAvailability();
  assert.ok(routes.size > 30);
  assert.ok(routes.has('POST /api/bookings') && routes.has('GET /api/events/:p/budget'));
  assert.deepEqual(unavailable, {}, 'all catalogued scenarios match real routes');
  const fake = scenarioAvailability(undefined, [{ id: 'fake', role: 'HOST', endpoints: ['GET /api/does-not-exist'] }]);
  assert.match(fake.unavailable.fake, /does-not-exist/);
  assert.ok(declaredRoutes().has('PATCH /api/bookings/:p/confirm'));
});
