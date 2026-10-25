// Builds the standalone HTML test report (summary table per suite + expandable detail).
const esc = value => String(value).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const STYLE = `
  body { font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1a1a1a; margin: 0; padding: 40px 16px; background: #fff; }
  main { max-width: 900px; margin: 0 auto; }
  h1 { font-size: 30px; margin: 0 0 18px; } h2 { font-size: 22px; margin: 32px 0 12px; }
  table { border-collapse: collapse; width: 100%; margin: 18px 0; }
  th, td { text-align: left; padding: 9px 8px; border-bottom: 1px solid #e3e3e3; vertical-align: top; }
  th { border-bottom: 1px solid #c9c9c9; }
  .pass { color: #0a7a3d; font-weight: 600; } .fail { color: #c0271b; font-weight: 600; } .skip { color: #9a6a00; font-weight: 600; }
  details { margin: 6px 0; } summary { cursor: pointer; } .detail td { font-size: 14px; } .note { color: #666; font-size: 13px; }
  @media (prefers-color-scheme: dark) {
    body { background: #16181b; color: #e8e8e8; } th, td { border-color: #33373c; }
    .pass { color: #4cc780; } .fail { color: #ff7b6e; } .skip { color: #e0b252; } .note { color: #9aa0a6; }
  }`;

// suites: [{ title, rows: [{ name, passed, skipped?, ms?, error?, note? }] }]
function buildHtml({ title, suites, footnote }) {
  const summarized = suites.map(suite => ({
    ...suite,
    passed: suite.rows.filter(row => row.passed).length,
    failed: suite.rows.filter(row => !row.passed && !row.skipped).length,
    skipped: suite.rows.filter(row => row.skipped).length,
    seconds: suite.rows.reduce((sum, row) => sum + (Number(row.ms) || 0), 0) / 1000
  }));
  const totalPassed = summarized.filter(suite => !suite.excludeFromTotal).reduce((sum, suite) => sum + suite.passed, 0);
  const totalFailed = summarized.reduce((sum, suite) => sum + suite.failed, 0);
  const summaryRows = summarized.map(suite => `<tr><td>${esc(suite.title)}</td><td>${suite.passed}</td><td>${suite.failed}</td>
    <td>${suite.seconds ? `${suite.seconds.toFixed(1)}s` : '–'}</td>
    <td class="${suite.failed ? 'fail' : 'pass'}">${suite.failed ? 'FAIL' : 'PASS'}${suite.skipped ? ` <span class="skip">(${suite.skipped} no test)</span>` : ''}</td></tr>`).join('\n');
  const detail = summarized.map(suite => `<details><summary>${esc(suite.title)}</summary><table class="detail"><tbody>${suite.rows.map(row => {
    const cls = row.skipped ? 'skip' : row.passed ? 'pass' : 'fail';
    const label = row.skipped ? 'NO TEST' : row.passed ? 'PASS' : 'FAIL';
    return `<tr><td class="${cls}">${label}</td><td>${esc(row.name)}${row.error ? ` — ${esc(row.error)}` : ''}${row.note ? `<div class="note">${esc(row.note)}</div>` : ''}</td></tr>`;
  }).join('')}</tbody></table></details>`).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><style>${STYLE}</style></head><body><main>
<h1>${esc(title)}</h1>
<p>Run: ${esc(new Date().toLocaleString('en-US'))} · Node ${esc(process.version)} · <span class="${totalFailed ? 'fail' : 'pass'}">${totalFailed ? 'FAILURES' : 'ALL PASSED'}</span> · ${totalPassed} passed, ${totalFailed} failed</p>
<table><thead><tr><th>Suite</th><th>Passed</th><th>Failed</th><th>Time</th><th>Result</th></tr></thead><tbody>
${summaryRows}
</tbody></table>
<p>${esc(footnote)}</p>
<h2>Detail</h2>
${detail}
</main></body></html>`;
}

module.exports = { buildHtml };
