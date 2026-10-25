// Builds the integration + UI test report (summary cards, numbered sections, click-to-expand tests with screenshots).
const esc = value => String(value ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const STYLE = `
  :root { --ink: #1a1a1a; --muted: #6b6b6b; --line: #e3e3e3; --card: #fff; --bg: #fff; --pass: #0a7a3d; --fail: #c0271b; --code: #f3f3f1; }
  @media (prefers-color-scheme: dark) { :root { --ink: #e8e8e8; --muted: #9aa0a6; --line: #33373c; --card: #1d2024; --bg: #16181b; --pass: #4cc780; --fail: #ff7b6e; --code: #23272b; } }
  body { font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--ink); background: var(--bg); margin: 0; padding: 36px 16px 64px; }
  main { max-width: 980px; margin: 0 auto; }
  h1 { font-size: 30px; line-height: 1.2; margin: 0 0 16px; }
  h2 { font-size: 22px; margin: 36px 0 10px; }
  .meta { color: var(--muted); font-size: 15px; margin: 0 0 22px; }
  .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin: 0 0 22px; }
  .card { border: 1px solid var(--line); border-radius: 10px; padding: 16px 20px; background: var(--card); }
  .card strong { display: block; font-size: 30px; line-height: 1.2; } .card span { color: var(--muted); }
  .card.good strong { color: var(--pass); } .card.bad strong { color: var(--fail); }
  details.test { border-bottom: 1px solid var(--line); } details.test > summary { display: flex; gap: 10px; padding: 11px 2px; cursor: pointer; list-style: none; }
  details.test > summary::-webkit-details-marker { display: none; }
  details.test > summary::before { content: "\\25B6"; font-size: 11px; color: var(--muted); margin-top: 5px; transition: transform .1s; }
  details.test[open] > summary::before { transform: rotate(90deg); }
  .name { flex: 1; } .time { color: var(--muted); font-size: 14px; white-space: nowrap; }
  .pass { color: var(--pass); font-weight: 700; } .fail { color: var(--fail); font-weight: 700; }
  .body { padding: 4px 4px 18px 24px; font-size: 15px; }
  .body ul { margin: 6px 0 12px; padding-left: 18px; } .body li { margin: 3px 0; }
  .err { background: var(--code); border-left: 4px solid var(--fail); padding: 10px 12px; margin: 8px 0 12px; font: 13px/1.5 ui-monospace, Consolas, monospace; white-space: pre-wrap; }
  .shot { max-width: 100%; border: 1px solid var(--line); border-radius: 8px; display: block; margin-top: 8px; }
  .kind { color: var(--muted); font-size: 13px; }
  code { background: var(--code); padding: 1px 5px; border-radius: 4px; font-size: .9em; }
  .findings li { margin: 8px 0; }
  @media (max-width: 640px) { .cards { grid-template-columns: 1fr; } }`;

// report = { title, meta[], summary, sections: [{ title, tests: [{ name, kind, passed, ms, notes[], error, screenshot }] }], findings[], limits[] }
function buildReport(report) {
  const all = report.sections.flatMap(section => section.tests);
  const passed = all.filter(test => test.passed).length;
  const failed = all.length - passed;
  const seconds = all.reduce((sum, test) => sum + test.ms, 0) / 1000;
  const sectionHtml = report.sections.map((section, index) => `
<h2>${index + 1}. ${esc(section.title)}</h2>
${section.tests.map(test => `<details class="test"${test.passed ? '' : ' open'}><summary><span class="${test.passed ? 'pass' : 'fail'}">${test.passed ? 'PASS' : 'FAIL'}</span><span class="name">${esc(test.name)} <span class="kind">· ${esc(test.kind)}</span></span><span class="time">${(test.ms / 1000).toFixed(1)}s</span></summary>
<div class="body">${test.error ? `<div class="err">${esc(test.error)}</div>` : ''}${test.notes.length ? `<ul>${test.notes.map(note => `<li>${esc(note)}</li>`).join('')}</ul>` : ''}${test.screenshot ? `<img class="shot" alt="Screenshot at the end of: ${esc(test.name)}" src="data:image/jpeg;base64,${test.screenshot}">` : ''}</div></details>`).join('\n')}`).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(report.title)}</title><style>${STYLE}</style></head><body><main>
<h1>${esc(report.title)}</h1>
<p class="meta">${report.meta.map(esc).join('<br>')}</p>
<div class="cards">
  <div class="card ${failed ? '' : 'good'}"><strong>${passed}/${all.length}</strong><span>tests passed</span></div>
  <div class="card ${failed ? 'bad' : ''}"><strong>${failed}</strong><span>failed</span></div>
  <div class="card"><strong>${seconds.toFixed(0)}s</strong><span>total test time</span></div>
</div>
<p>${report.summary}</p>
${sectionHtml}
${report.findings?.length ? `<h2>${report.sections.length + 1}. Problems found and fixed while testing</h2><ul class="findings">${report.findings.map(item => `<li>${item}</li>`).join('')}</ul>` : ''}
${report.limits?.length ? `<h2>${report.sections.length + (report.findings?.length ? 2 : 1)}. What this run does not cover</h2><ul class="findings">${report.limits.map(item => `<li>${item}</li>`).join('')}</ul>` : ''}
</main></body></html>`;
}

module.exports = { buildReport };
