// Log-scale latency histogram (about 1% relative accuracy). Lets us keep percentiles for millions of requests in
// constant memory and merge histograms from different time slices or endpoints.
'use strict';

const GAMMA = 1.02;
const LOG_GAMMA = Math.log(GAMMA);
const FLOOR_MS = 0.1;

class Histogram {
  constructor() { this.counts = new Map(); this.count = 0; this.sum = 0; this.min = Infinity; this.max = 0; this._keys = null; }

  static indexFor(value) { return value <= FLOOR_MS ? 0 : Math.ceil(Math.log(value / FLOOR_MS) / LOG_GAMMA); }
  static valueFor(index) { return FLOOR_MS * Math.pow(GAMMA, index); }

  add(value, times = 1) {
    if (!Number.isFinite(value) || value < 0) return;
    const index = Histogram.indexFor(value);
    const existing = this.counts.get(index);
    if (existing === undefined) { this.counts.set(index, times); this._keys = null; } else this.counts.set(index, existing + times);
    this.count += times; this.sum += value * times;
    if (value < this.min) this.min = value;
    if (value > this.max) this.max = value;
  }

  merge(other) {
    if (!other || !other.count) return this;
    for (const [index, count] of other.counts) {
      const existing = this.counts.get(index);
      if (existing === undefined) { this.counts.set(index, count); this._keys = null; } else this.counts.set(index, existing + count);
    }
    this.count += other.count; this.sum += other.sum;
    this.min = Math.min(this.min, other.min); this.max = Math.max(this.max, other.max);
    return this;
  }

  percentile(p) {
    if (!this.count) return null;
    if (!this._keys) this._keys = [...this.counts.keys()].sort((a, b) => a - b);
    const target = Math.max(1, Math.ceil((p / 100) * this.count));
    let seen = 0;
    for (const key of this._keys) {
      seen += this.counts.get(key);
      if (seen >= target) return Math.min(this.max, Math.max(this.min, Histogram.valueFor(key)));
    }
    return this.max;
  }

  mean() { return this.count ? this.sum / this.count : null; }

  stats() {
    if (!this.count) return { count: 0, avg: null, min: null, p50: null, p90: null, p95: null, p99: null, max: null };
    return { count: this.count, avg: this.mean(), min: this.min, p50: this.percentile(50), p90: this.percentile(90), p95: this.percentile(95), p99: this.percentile(99), max: this.max };
  }

  toJSON() { return { count: this.count, sum: this.sum, min: this.count ? this.min : 0, max: this.max, buckets: [...this.counts.entries()] }; }

  static fromJSON(data) {
    const histogram = new Histogram();
    if (!data) return histogram;
    histogram.count = data.count; histogram.sum = data.sum; histogram.max = data.max; histogram.min = data.count ? data.min : Infinity;
    for (const [index, count] of data.buckets) histogram.counts.set(index, count);
    return histogram;
  }
}

module.exports = { Histogram };
