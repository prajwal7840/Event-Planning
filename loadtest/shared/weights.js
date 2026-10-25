// Role assignment and weighted scenario selection (shared by k6 and Node).
'use strict';
const { hashString } = require('./prng.js');

const ROLE_ORDER = ['HOST', 'VENDOR', 'INVITEE'];

function mixTotal(mix) { return ROLE_ORDER.reduce((sum, role) => sum + (Number(mix[role]) || 0), 0); }

// Deterministic, evenly spread role for virtual user number `vuId` (1-based).
// A golden-ratio low-discrepancy sequence keeps the role mix close to the configured percentages at every
// concurrency level during the ramp, instead of only on average at the end.
function roleForVu(vuId, mix, seed) {
  const total = mixTotal(mix);
  const offset = (hashString(String(seed) + ':roles') % 100000) / 100000;
  const u = ((vuId * 0.6180339887498949) + offset) % 1;
  let cumulative = 0;
  for (const role of ROLE_ORDER) {
    cumulative += ((Number(mix[role]) || 0) / total);
    if (u < cumulative) return role;
  }
  return ROLE_ORDER[ROLE_ORDER.length - 1];
}

// Scenarios a role may run, with their configured weights. Unavailable scenarios and zero weights are excluded.
function eligibleScenarios(catalog, role, weights, unavailable) {
  return catalog
    .filter(scenario => scenario.role === role && !(unavailable && unavailable[scenario.id]))
    .map(scenario => ({ id: scenario.id, weight: Number(weights[scenario.id] !== undefined ? weights[scenario.id] : scenario.defaultWeight) || 0 }))
    .filter(entry => entry.weight > 0);
}

module.exports = { ROLE_ORDER, mixTotal, roleForVu, eligibleScenarios };
