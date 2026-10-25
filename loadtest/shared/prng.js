// Seeded pseudo-random numbers. CommonJS so the same file runs in Node (tests, worker) and inside k6 (via require).
// Same seed + same stream name => same sequence, which is what makes a load test repeatable.
'use strict';

function hashString(text) { // FNV-1a, 32 bit
  let hash = 2166136261;
  const value = String(text);
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A random stream for (seed, stream). Use a different stream name per virtual user / purpose.
function createRng(seed, stream) {
  const base = typeof seed === 'number' && Number.isFinite(seed) ? seed >>> 0 : hashString(seed);
  const next = mulberry32((base ^ hashString(stream === undefined ? '' : stream)) >>> 0);
  const rng = {
    next,
    float(min, max) { return min + next() * (max - min); },
    int(min, max) { return Math.floor(min + next() * (max - min + 1)); }, // inclusive both ends
    chance(probability) { return next() < probability; },
    pick(items) { return items[Math.floor(next() * items.length)]; },
    shuffle(items) {
      const copy = items.slice();
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        const swap = copy[i]; copy[i] = copy[j]; copy[j] = swap;
      }
      return copy;
    },
    // entries: [{ id, weight }]; entries with weight <= 0 are never chosen. Returns undefined if nothing is eligible.
    weighted(entries) {
      let total = 0;
      for (let i = 0; i < entries.length; i += 1) if (entries[i].weight > 0) total += entries[i].weight;
      if (total <= 0) return undefined;
      let roll = next() * total;
      for (let i = 0; i < entries.length; i += 1) {
        if (entries[i].weight <= 0) continue;
        roll -= entries[i].weight;
        if (roll < 0) return entries[i];
      }
      return entries[entries.length - 1];
    }
  };
  return rng;
}

module.exports = { hashString, mulberry32, createRng };
