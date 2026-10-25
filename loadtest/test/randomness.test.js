const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRng, hashString } = require('../shared/prng');
const { roleForVu, eligibleScenarios, ROLE_ORDER } = require('../shared/weights');
const { SCENARIOS } = require('../shared/catalog');

const draw = (rng, n) => Array.from({ length: n }, () => rng.next());

test('same seed and stream give the same sequence; different seeds or streams differ', () => {
  assert.deepEqual(draw(createRng('abc', 'vu:1'), 20), draw(createRng('abc', 'vu:1'), 20));
  assert.notDeepEqual(draw(createRng('abc', 'vu:1'), 20), draw(createRng('abc', 'vu:2'), 20));
  assert.notDeepEqual(draw(createRng('abc', 'vu:1'), 20), draw(createRng('abd', 'vu:1'), 20));
  assert.equal(hashString('x'), hashString('x'));
  assert.ok(draw(createRng('s'), 1000).every(v => v >= 0 && v < 1));
});

test('rng helpers stay in range and shuffling keeps every element', () => {
  const rng = createRng('range', 't');
  for (let i = 0; i < 500; i += 1) { const v = rng.int(3, 7); assert.ok(v >= 3 && v <= 7 && Number.isInteger(v)); }
  const seen = new Set(Array.from({ length: 500 }, () => rng.int(3, 7)));
  assert.deepEqual([...seen].sort(), [3, 4, 5, 6, 7], 'both ends are reachable');
  const shuffled = rng.shuffle([1, 2, 3, 4, 5, 6]);
  assert.deepEqual([...shuffled].sort(), [1, 2, 3, 4, 5, 6]);
  assert.equal(rng.pick(['only']), 'only');
  assert.equal(rng.chance(0), false); assert.equal(rng.chance(1.01), true);
});

test('weighted selection follows the weights, skips zero weights and returns nothing when nothing is eligible', () => {
  const rng = createRng('weights', 'a');
  const counts = { a: 0, b: 0, c: 0 };
  for (let i = 0; i < 20000; i += 1) counts[rng.weighted([{ id: 'a', weight: 70 }, { id: 'b', weight: 30 }, { id: 'c', weight: 0 }]).id] += 1;
  assert.equal(counts.c, 0);
  assert.ok(Math.abs(counts.a / 20000 - 0.7) < 0.02, `a was ${counts.a / 20000}`);
  assert.equal(rng.weighted([{ id: 'x', weight: 0 }]), undefined);
  assert.equal(rng.weighted([]), undefined);
});

test('role assignment matches the configured mix at every concurrency level and is repeatable', () => {
  const mix = { HOST: 50, VENDOR: 20, INVITEE: 30 };
  for (const n of [10, 50, 200, 1000]) {
    const counts = { HOST: 0, VENDOR: 0, INVITEE: 0 };
    for (let id = 1; id <= n; id += 1) counts[roleForVu(id, mix, 'seed-1')] += 1;
    for (const role of ROLE_ORDER) assert.ok(Math.abs(counts[role] / n - mix[role] / 100) <= Math.max(0.1, 3 / n), `${n} users, ${role}: ${counts[role] / n}`);
  }
  assert.equal(roleForVu(37, mix, 'seed-1'), roleForVu(37, mix, 'seed-1'));
  assert.equal(new Set(Array.from({ length: 100 }, (_, i) => roleForVu(i + 1, { HOST: 100, VENDOR: 0, INVITEE: 0 }, 's'))).size, 1, '100% host means only hosts');
});

test('role-eligible scenarios exclude other roles, unavailable scenarios and zero weights', () => {
  const host = eligibleScenarios(SCENARIOS, 'HOST', {}, {});
  assert.ok(host.length >= 5 && host.every(e => e.id.startsWith('host_')), 'a vendor or invitee journey must never be given to a host');
  assert.ok(eligibleScenarios(SCENARIOS, 'VENDOR', {}, {}).every(e => e.id.startsWith('vendor_')));
  assert.ok(eligibleScenarios(SCENARIOS, 'INVITEE', {}, {}).every(e => e.id.startsWith('invitee_')));
  assert.ok(!eligibleScenarios(SCENARIOS, 'HOST', {}, { host_booking_flow: 'missing' }).some(e => e.id === 'host_booking_flow'));
  assert.ok(!eligibleScenarios(SCENARIOS, 'HOST', { host_booking_flow: 0 }, {}).some(e => e.id === 'host_booking_flow'));
  assert.equal(eligibleScenarios(SCENARIOS, 'HOST', { host_booking_flow: 55 }, {}).find(e => e.id === 'host_booking_flow').weight, 55);
});

test('the same seed reproduces the same sequence of journeys for a user', () => {
  const pick = seed => { const rng = createRng(seed, 'vu:5'); const entries = eligibleScenarios(SCENARIOS, 'HOST', {}, {}); return Array.from({ length: 25 }, () => rng.weighted(entries).id); };
  assert.deepEqual(pick('repeat-me'), pick('repeat-me'));
  assert.notDeepEqual(pick('repeat-me'), pick('another'));
  assert.ok(new Set(pick('repeat-me')).size > 2, 'users do not all run the same journey');
});

test('the k6 script and Node share exactly the same random generator', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const runtime = fs.readFileSync(path.join(__dirname, '../k6/runtime.js'), 'utf8');
  assert.match(runtime, /require\('\.\.\/shared\/prng\.js'\)/);
  assert.match(runtime, /require\('\.\.\/shared\/weights\.js'\)/);
});
