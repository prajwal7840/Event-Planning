// Dependency-free SVG charts, used by the HTML reports (Node) and the live dashboard (browser).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LTCharts = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const COLORS = { green: '#14362a', coral: '#ee6c4d', lime: '#7aa21a', amber: '#d9962b', blue: '#3b6ea5', purple: '#7b5ea7', grey: '#8a8f87', red: '#c0271b' };
  const STYLE = '<style>.lt-grid{stroke:#e6e3da}.lt-axis{stroke:#9a9a92}.lt-tx{fill:#6b6b63;font:11px system-ui,sans-serif}.lt-title{fill:#6b6b63;font:11px system-ui,sans-serif}.lt-bar-bg{fill:#efece3}' +
    '@media (prefers-color-scheme:dark){.lt-grid{stroke:#33373c}.lt-axis{stroke:#5d6269}.lt-tx,.lt-title{fill:#9aa0a6}.lt-bar-bg{fill:#2a2e33}}</style>';
  const esc = v => String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function niceStep(range, ticks) {
    const rough = range / Math.max(1, ticks);
    const pow = Math.pow(10, Math.floor(Math.log10(rough || 1)));
    const f = rough / pow;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pow;
  }
  function niceMax(max) { if (!(max > 0)) return 1; const step = niceStep(max, 4); return Math.ceil(max / step) * step; }
  function fmtNumber(v) { if (v === null || v === undefined) return ''; const a = Math.abs(v); if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`; if (a >= 10000) return `${Math.round(v / 1000)}k`; if (a >= 1000) return `${(v / 1000).toFixed(1)}k`; return a >= 100 || Number.isInteger(v) ? String(Math.round(v)) : v.toFixed(a >= 10 ? 1 : 2); }
  function fmtTime(seconds) { const s = Math.round(seconds); const m = Math.floor(s / 60); return `${m}:${String(s % 60).padStart(2, '0')}`; }
  function timeStep(span) { const options = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800]; return options.find(o => span / o <= 8) || 3600; }

  function downsample(points, max) {
    if (points.length <= max) return points;
    const size = Math.ceil(points.length / max); const out = [];
    for (let i = 0; i < points.length; i += size) {
      const chunk = points.slice(i, i + size); const ys = chunk.map(p => p[1]).filter(y => y !== null && y !== undefined);
      out.push([chunk[0][0], ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : null]);
    }
    return out;
  }

  // options: { width, height, series: [{ name, color, data: [[x, y], ...], dash, area }], yFormat, xFormat, yMax, yTitle, markers: [{ x, label }] }
  function lineChart(options) {
    const width = options.width || 900; const height = options.height || 240;
    const m = { l: 52, r: 14, t: 10, b: options.series.length > 1 ? 44 : 26 };
    const series = options.series.map(s => ({ ...s, data: downsample(s.data.filter(p => p && p[0] !== null), 700) }));
    const xs = series.flatMap(s => s.data.map(p => p[0]));
    if (!xs.length) return `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="${esc(options.yTitle || 'chart')}">${STYLE}<text class="lt-tx" x="${width / 2}" y="${height / 2}" text-anchor="middle">No data yet</text></svg>`;
    const xMin = Math.min(...xs); const xMax = Math.max(...xs, xMin + 1);
    const ys = series.flatMap(s => s.data.map(p => p[1]).filter(y => y !== null && y !== undefined));
    const yMax = options.yMax || niceMax(ys.length ? Math.max(...ys) : 1);
    const px = x => m.l + ((x - xMin) / (xMax - xMin)) * (width - m.l - m.r);
    const py = y => height - m.b - (y / yMax) * (height - m.t - m.b);
    const yFmt = options.yFormat || fmtNumber; const xFmt = options.xFormat || fmtTime;
    let out = `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="${esc(options.yTitle || 'chart')}" preserveAspectRatio="xMidYMid meet">${STYLE}`;
    const yStep = niceStep(yMax, 4);
    for (let y = 0; y <= yMax + 1e-9; y += yStep) out += `<line class="lt-grid" x1="${m.l}" x2="${width - m.r}" y1="${py(y)}" y2="${py(y)}"/><text class="lt-tx" x="${m.l - 6}" y="${py(y) + 4}" text-anchor="end">${esc(yFmt(y))}</text>`;
    const xStep = timeStep(xMax - xMin);
    for (let x = Math.ceil(xMin / xStep) * xStep; x <= xMax; x += xStep) out += `<line class="lt-grid" x1="${px(x)}" x2="${px(x)}" y1="${m.t}" y2="${height - m.b}" stroke-dasharray="2 4"/><text class="lt-tx" x="${px(x)}" y="${height - m.b + 14}" text-anchor="middle">${esc(xFmt(x))}</text>`;
    out += `<line class="lt-axis" x1="${m.l}" x2="${width - m.r}" y1="${height - m.b}" y2="${height - m.b}"/>`;
    for (const marker of options.markers || []) if (marker.x >= xMin && marker.x <= xMax) out += `<line x1="${px(marker.x)}" x2="${px(marker.x)}" y1="${m.t}" y2="${height - m.b}" stroke="#9a9a92" stroke-dasharray="3 3"/><text class="lt-tx" x="${px(marker.x) + 3}" y="${m.t + 9}">${esc(marker.label)}</text>`;
    for (const s of series) {
      const color = s.color || COLORS.green; let d = ''; let pen = false; let first = null; let last = null;
      for (const [x, y] of s.data) {
        if (y === null || y === undefined) { pen = false; continue; }
        d += `${pen ? 'L' : 'M'}${px(x).toFixed(1)} ${py(Math.min(y, yMax)).toFixed(1)}`; pen = true; if (first === null) first = x; last = x;
      }
      if (s.area && d) out += `<path d="${d}L${px(last).toFixed(1)} ${py(0)}L${px(first).toFixed(1)} ${py(0)}Z" fill="${color}" fill-opacity="0.12" stroke="none"/>`;
      if (d) out += `<path d="${d}" fill="none" stroke="${color}" stroke-width="${s.width || 1.8}" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''} stroke-linejoin="round"/>`;
    }
    if (series.length > 1) {
      let x = m.l;
      for (const s of series) { out += `<rect x="${x}" y="${height - 12}" width="10" height="3" fill="${s.color}"/><text class="lt-tx" x="${x + 14}" y="${height - 7}">${esc(s.name)}</text>`; x += 26 + s.name.length * 6.2; }
    }
    return `${out}</svg>`;
  }

  // options: { items: [{ label, value, color, note }], width, formatValue }
  function barChart(options) {
    const width = options.width || 600; const rowH = 24; const left = options.labelWidth || 120;
    const items = options.items; const height = Math.max(40, items.length * rowH + 8);
    const max = Math.max(1, ...items.map(i => i.value)); const fmt = options.formatValue || fmtNumber;
    let out = `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="${esc(options.title || 'bar chart')}">${STYLE}`;
    items.forEach((item, i) => {
      const y = i * rowH + 4; const w = ((width - left - 70) * item.value) / max;
      out += `<text class="lt-tx" x="${left - 8}" y="${y + 14}" text-anchor="end">${esc(item.label)}</text><rect class="lt-bar-bg" x="${left}" y="${y + 3}" width="${width - left - 70}" height="14" rx="3"/>` +
        `<rect x="${left}" y="${y + 3}" width="${Math.max(item.value > 0 ? 2 : 0, w)}" height="14" rx="3" fill="${item.color || COLORS.green}"/><text class="lt-tx" x="${left + (width - left - 70) + 6}" y="${y + 14}">${esc(fmt(item.value))}${item.note ? ` ${esc(item.note)}` : ''}</text>`;
    });
    return `${out}</svg>`;
  }

  return { COLORS, lineChart, barChart, fmtNumber, fmtTime, esc };
}));
