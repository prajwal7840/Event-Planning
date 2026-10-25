/* Load-test console UI (no build step). Talks to /api with a bearer token kept in sessionStorage. */
(() => {
  'use strict';
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = LTCharts.esc;
  const ACTIVE = ['queued', 'preparing', 'running', 'ramping-down', 'cancelling', 'finalizing'];
  const STATE_TEXT = { queued: 'Queued', preparing: 'Preparing', running: 'Running', 'ramping-down': 'Ramping down', cancelling: 'Cancelling', finalizing: 'Finalizing', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled', aborted: 'Stopped by safety limit' };
  const CLASS_TEXT = { improvement: 'Improvement', no_material_change: 'No material change', potential_regression: 'Potential regression', confirmed_threshold_failure: 'Confirmed threshold failure', inconclusive: 'Inconclusive' };
  const state = { token: sessionStorage.getItem('lt_token') || '', meta: null, config: null, validation: null, runId: null, poll: null, tab: 'new', history: [] };

  const fmt = (v, d = 1) => (v === null || v === undefined ? 'n/a' : Number(v).toLocaleString('en-US', { maximumFractionDigits: d }));
  const ms = v => (v === null || v === undefined ? 'n/a' : `${fmt(v, v >= 100 ? 0 : 1)} ms`);
  const dur = s => { s = Math.round(s); return s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`; };
  const toast = text => { const t = $('#toast'); t.textContent = text; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 3200); };
  const badge = (key, text) => `<span class="badge b-${key}">${esc(text || key)}</span>`;

  async function api(path, options = {}) {
    const response = await fetch(`/api${path}`, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}`, ...(options.headers || {}) }, body: options.body ? JSON.stringify(options.body) : undefined });
    if (response.status === 401) { showGate('That token was not accepted.'); throw new Error('unauthorized'); }
    const type = response.headers.get('content-type') || '';
    const data = type.includes('json') ? await response.json() : await response.blob();
    if (!response.ok) { const error = new Error((data && data.message) || `Request failed (${response.status})`); error.data = data; throw error; }
    return data;
  }
  async function download(path, filename) {
    const blob = await api(path);
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  // ------------------------------------------------------------------ gate + tabs
  function showGate(message) { $('#gate').classList.remove('hidden'); $('#app').classList.add('hidden'); $('#gate-error').textContent = message || ''; }
  $('#gate-form').addEventListener('submit', async event => {
    event.preventDefault(); state.token = $('#gate-token').value.trim(); sessionStorage.setItem('lt_token', state.token);
    try { await start(); } catch (error) { /* gate already shown */ }
  });
  function setTab(tab) {
    state.tab = tab;
    $$('#nav button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $$('.tab').forEach(s => s.classList.toggle('hidden', s.id !== `tab-${tab}`));
    if (tab === 'history') renderHistory(); if (tab === 'compare') renderCompare(); if (tab === 'live') renderLive();
  }
  $('#nav').addEventListener('click', event => { const b = event.target.closest('button[data-tab]'); if (b) setTab(b.dataset.tab); });

  // ------------------------------------------------------------------ config helpers
  const getPath = (obj, path) => path.split('.').reduce((o, k) => (o ? o[k] : undefined), obj);
  const setPath = (obj, path, value) => { const keys = path.split('.'); const last = keys.pop(); keys.reduce((o, k) => (o[k] = o[k] || {}), obj)[last] = value; };
  function mergeInto(base, extra) { for (const k of Object.keys(extra || {})) { if (extra[k] && typeof extra[k] === 'object' && !Array.isArray(extra[k])) { base[k] = mergeInto(base[k] || {}, extra[k]); } else base[k] = extra[k]; } return base; }
  const clone = v => JSON.parse(JSON.stringify(v));
  const newSeed = () => Math.random().toString(36).slice(2, 8);

  function input(label, path, { type = 'number', step, min, hint, suffix } = {}) {
    const value = getPath(state.config, path);
    return `<div class="field"><label>${esc(label)}${suffix ? ` (${esc(suffix)})` : ''}<input data-path="${path}" type="${type}" ${step ? `step="${step}"` : ''} ${min !== undefined ? `min="${min}"` : ''} value="${esc(value === undefined ? '' : value)}"></label>${hint ? `<small>${esc(hint)}</small>` : ''}</div>`;
  }

  // ------------------------------------------------------------------ NEW TEST
  function renderNew() {
    const m = state.meta; const c = state.config;
    const presetOptions = Object.entries(m.presets).map(([k, p]) => `<option value="preset:${k}">${esc(p.label)}</option>`).join('') + m.profiles.map(p => `<option value="profile:${esc(p.name)}">Saved: ${esc(p.name)}</option>`).join('');
    const envOptions = m.environments.map(e => `<option value="${esc(e.key)}" ${e.key === c.environment ? 'selected' : ''} ${!e.enabled || e.production ? 'disabled' : ''}>${esc(e.label)}${e.production ? ' (production: not allowed)' : ''}</option>`).join('');
    const roles = ['HOST', 'VENDOR', 'INVITEE'];
    const scenarioHtml = roles.map(role => `<div><h3>${role === 'HOST' ? 'Hosts' : role === 'VENDOR' ? 'Vendors' : 'Invitees'}</h3><div class="weights">${m.scenarios.filter(s => s.role === role).map(s =>
      `<div class="${s.unavailable ? 'un' : ''}" title="${esc(s.unavailable || s.description)}"><b>${esc(s.label)}</b><br><span class="small muted">${esc(s.unavailable ? `Unavailable: ${s.unavailable}` : s.description)}</span></div><input data-path="scenarioWeights.${s.id}" type="number" min="0" step="1" value="${esc(c.scenarioWeights[s.id] ?? s.defaultWeight)}" ${s.unavailable ? 'disabled' : ''} aria-label="Weight for ${esc(s.label)}">`).join('')}</div></div>`).join('');
    $('#tab-new').innerHTML = `
      <h1>Configure a load test</h1>
      <p class="lede">A <b>virtual user</b> is one simulated person who logs in and then repeats randomised journeys with pauses between actions. It is not one request per second: ${esc(String(c.maxVus))} users typically produce far fewer concurrent requests. Tests run against a throw-away copy of the app and database, never your real data.</p>
      <div class="card"><div class="grid g3">
        <div class="field"><label>Start from<select id="preset"><option value="">(current settings)</option>${presetOptions}</select></label></div>
        ${input('Test name', 'name', { type: 'text' })}
        <div class="field"><label>Target environment<select data-path="environment">${envOptions}</select></label><small id="env-desc"></small></div>
      </div></div>
      <div class="card"><h3>Load profile</h3>
        <div class="grid g4">
          ${input('Total duration', 'durationSeconds', { suffix: 'seconds', min: 1, hint: 'Includes warm-up, ramp-up and ramp-down.' })}
          ${input('Maximum concurrent users', 'maxVus', { min: 1 })}
          ${input('Warm-up', 'warmupSeconds', { suffix: 'seconds' })}
          ${input('Warm-up users', 'warmupVus')}
          ${input('Ramp-up', 'rampUpSeconds', { suffix: 'seconds' })}
          ${input('Ramp-down', 'rampDownSeconds', { suffix: 'seconds' })}
          ${input('Random seed', 'seed', { type: 'text', hint: 'Same seed + settings = same per-user choices.' })}
          <div class="field"><label>&nbsp;</label><button class="btn" id="new-seed" type="button">New random seed</button></div>
        </div>
        <div class="chips" id="duration-chips">${[1, 5, 15, 30, 60].map(minutes => `<button class="chip" type="button" data-minutes="${minutes}">${minutes} min</button>`).join('')}</div>
        <div id="plan-box"></div>
      </div>
      <div class="card"><h3>Who is using the system</h3>
        <div class="grid g3">${input('Hosts', 'roleMix.HOST', { suffix: '%' })}${input('Vendors', 'roleMix.VENDOR', { suffix: '%' })}${input('Invitees', 'roleMix.INVITEE', { suffix: '%' })}</div>
        <p class="small muted" id="mix-note"></p>
        <details class="fold"><summary>Scenario weights (what each role does)</summary><p class="small muted">Weights are relative within a role. Each user picks a journey by weight, so not everyone does everything. Set 0 to disable.</p><div class="grid g3">${scenarioHtml}</div></details>
      </div>
      <div class="card"><h3>Behaviour and pacing</h3><div class="grid g4">
        ${input('Think time min', 'thinkTime.minMs', { suffix: 'ms' })}${input('Think time max', 'thinkTime.maxMs', { suffix: 'ms' })}
        ${input('Minimum gap between requests', 'pacing.minRequestGapMs', { suffix: 'ms', hint: 'Stops a user firing requests in a tight loop.' })}${input('Early-stop chance', 'journey.earlyStopChance', { step: '0.05', hint: '0 to 1: users who leave a journey early.' })}
        ${input('Actions per journey, min', 'journey.minActions')}${input('Actions per journey, max', 'journey.maxActions')}
        <div class="field"><label>Negative testing<select data-path="negativeTesting.enabled" data-type="bool"><option value="false" ${!c.negativeTesting.enabled ? 'selected' : ''}>Off (valid requests only)</option><option value="true" ${c.negativeTesting.enabled ? 'selected' : ''}>On (some invalid or forbidden requests)</option></select></label></div>
        ${input('Negative-request rate', 'negativeTesting.rate', { step: '0.01' })}
      </div></div>
      <div class="card"><h3>Pass / fail limits</h3><div class="grid g4">
        ${input('p95 response time', 'thresholds.p95Ms', { suffix: 'ms' })}${input('p99 response time', 'thresholds.p99Ms', { suffix: 'ms' })}
        ${input('Error rate', 'thresholds.errorRatePct', { suffix: '%', step: '0.1' })}${input('Timeout rate', 'thresholds.timeoutRatePct', { suffix: '%', step: '0.1' })}
        ${input('Minimum throughput', 'thresholds.minRps', { suffix: 'req/s', hint: '0 = not checked.' })}
        ${input('Safety stop: error rate', 'safety.abortErrorRatePct', { suffix: '%' })}${input('…for', 'safety.abortAfterSeconds', { suffix: 'seconds' })}
      </div>
      <details class="fold"><summary>Test data and comparison settings</summary><div class="grid g4" style="margin-top:8px">
        ${input('Events seeded per host', 'data.eventsPerHost')}${input('Max records a user keeps created', 'data.maxCreatedPerUser', { hint: 'Keeps data from growing without limit.' })}
        ${input('Hosts (0 = automatic)', 'data.hosts')}${input('Vendors (0 = automatic)', 'data.vendors')}${input('Invitees (0 = automatic)', 'data.invitees')}
        ${input('Regression: latency worse by', 'comparison.latencyPct', { suffix: '%' })}${input('Regression: error rate up by', 'comparison.errorRatePp', { suffix: 'points', step: '0.1' })}${input('Regression: throughput down by', 'comparison.throughputDropPct', { suffix: '%' })}
        <div class="field"><label>Compare with latest comparable run<select data-path="comparison.autoBaseline" data-type="bool"><option value="true" ${c.comparison.autoBaseline ? 'selected' : ''}>Yes (in the report)</option><option value="false" ${!c.comparison.autoBaseline ? 'selected' : ''}>No</option></select></label></div>
      </div></details></div>
      <div class="card" id="start-card"></div>`;
    bindNew(); refreshValidation();
  }

  function bindNew() {
    const root = $('#tab-new');
    root.oninput = event => {
      const el = event.target; const path = el.dataset && el.dataset.path; if (!path) return;
      let value = el.value;
      if (el.dataset.type === 'bool') value = value === 'true'; else if (el.type === 'number') value = value === '' ? '' : Number(value);
      setPath(state.config, path, value);
      if (path.startsWith('roleMix') || path === 'environment') updateStatic();
      scheduleValidation();
    };
    $('#new-seed').addEventListener('click', () => { state.config.seed = newSeed(); $('[data-path="seed"]').value = state.config.seed; scheduleValidation(); });
    $('#duration-chips').addEventListener('click', event => { const chip = event.target.closest('[data-minutes]'); if (!chip) return; state.config.durationSeconds = Number(chip.dataset.minutes) * 60; $('[data-path="durationSeconds"]').value = state.config.durationSeconds; scheduleValidation(); });
    $('#preset').addEventListener('change', event => {
      const [kind, key] = event.target.value.split(':'); if (!kind) return;
      const source = kind === 'preset' ? state.meta.presets[key].config : state.meta.profiles.find(p => p.name === key).config;
      state.config = mergeInto(clone(state.meta.defaults), clone(source)); state.config.seed = state.config.seed || newSeed(); renderNew();
    });
    updateStatic();
  }
  function updateStatic() {
    const c = state.config; const sum = ['HOST', 'VENDOR', 'INVITEE'].reduce((a, r) => a + (Number(c.roleMix[r]) || 0), 0);
    $('#mix-note').innerHTML = Math.abs(sum - 100) > 0.5 ? `<span class="error">Roles add up to ${fmt(sum)}%: they must total 100%.</span>` : 'Roles add up to 100%.';
    const env = state.meta.environments.find(e => e.key === c.environment); $('#env-desc').textContent = env ? env.description : '';
  }
  let validationTimer = null;
  function scheduleValidation() { clearTimeout(validationTimer); validationTimer = setTimeout(refreshValidation, 350); }
  async function refreshValidation() {
    try { state.validation = await api('/validate', { method: 'POST', body: { config: state.config } }); } catch (error) { return; }
    const v = state.validation;
    const plan = v.plan;
    $('#plan-box').innerHTML = `${v.errors.map(e => `<div class="msg err">${esc(e)}</div>`).join('')}${v.warnings.map(w => `<div class="msg warn">${esc(w)}</div>`).join('')}
      ${plan && v.preview.length ? `<h3>Expected load progression</h3><div class="chart">${LTCharts.lineChart({ height: 190, yTitle: 'Virtual users', markers: plan.stages.slice(1).map(s => ({ x: s.startSeconds, label: s.name })), series: [{ name: 'Configured users', color: LTCharts.COLORS.green, area: true, data: v.preview }] })}</div>
      <div class="scroll"><table><thead><tr><th>Stage</th><th class="n">Starts</th><th class="n">Length</th><th class="n">Users</th></tr></thead><tbody>${plan.stages.map(s => `<tr><td>${esc(s.name)}</td><td class="n">${dur(s.startSeconds)}</td><td class="n">${dur(s.durationSeconds)}</td><td class="n">${s.fromVus} → ${s.toVus}</td></tr>`).join('')}</tbody></table></div>
      <p class="small muted">Duration ${dur(plan.durationSeconds)} = warm-up + ramp-up + sustained load (${dur(Math.max(0, plan.sustainSeconds))}) + ramp-down. Up to ${plan.gracefulStopSeconds}s of cool-down may follow so in-flight journeys can finish. Accounts to be created: ${esc(JSON.stringify(v.accounts))}.</p>` : ''}`;
    renderStart();
  }
  function renderStart() {
    const v = state.validation; const c = state.config; const busy = state.meta.activeRun;
    const card = $('#start-card'); if (!card) return;
    const typed = ($('#confirm-env') || {}).value || '';
    card.innerHTML = `<h3>Start</h3>
      <p class="small">Target: <b>${esc(c.environment)}</b>. This run will create a copy of the database schema, start a second copy of the API, seed test accounts and records, generate up to <b>${esc(String(c.maxVus))}</b> concurrent users for <b>${esc(dur(c.durationSeconds || 0))}</b>, then remove everything it created. Your real database and running app are not used.</p>
      <div class="grid g2"><div class="field"><label>To confirm, type the environment name: <code>${esc(c.environment)}</code><input id="confirm-env" autocomplete="off" value="${esc(typed)}"></label></div>
      <div class="field"><label>&nbsp;</label><div class="row"><button class="btn primary" id="start-run" type="button" disabled>Start load test</button><button class="btn" id="save-profile" type="button">Save as profile…</button></div></div></div>
      ${!state.meta.engine.installed ? '<div class="msg err">The k6 engine is not installed. Run <code>node loadtest/tools/install-k6.js</code> in the project folder.</div>' : ''}
      ${busy ? `<div class="msg warn">A test is already active (${esc(busy.name)}). Open <b>Live run</b>.</div>` : ''}<div id="start-msg"></div>`;
    const update = () => { $('#start-run').disabled = !(v && v.valid) || $('#confirm-env').value.trim() !== c.environment || !state.meta.engine.installed || Boolean(state.meta.activeRun); };
    $('#confirm-env').addEventListener('input', update); update();
    $('#start-run').addEventListener('click', async () => {
      $('#start-run').disabled = true;
      try { const result = await api('/runs', { method: 'POST', body: { config: state.config, confirmEnvironment: $('#confirm-env').value.trim() } }); toast('Test started'); state.runId = result.id; state.meta.activeRun = { id: result.id, name: c.name }; setTab('live'); }
      catch (error) { $('#start-msg').innerHTML = `<div class="msg err">${esc(error.message)}${error.data && error.data.errors ? `<ul>${error.data.errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}</div>`; update(); }
    });
    $('#save-profile').addEventListener('click', async () => {
      const name = prompt('Profile name'); if (!name) return;
      try { await api('/profiles', { method: 'POST', body: { name, config: state.config } }); state.meta = await api('/meta'); toast('Profile saved'); renderNew(); } catch (error) { toast(error.message); }
    });
  }

  // ------------------------------------------------------------------ LIVE
  function targetAt(plan, t) { for (const s of plan.stages) if (t <= s.startSeconds + s.durationSeconds) return Math.round(s.fromVus + (s.toVus - s.fromVus) * ((t - s.startSeconds) / s.durationSeconds)); return 0; }
  async function renderLive() {
    clearInterval(state.poll);
    const root = $('#tab-live');
    if (!state.runId) {
      const active = state.meta && state.meta.activeRun;
      if (active) state.runId = active.id;
      else {
        const runs = await api('/runs').catch(() => []);
        root.innerHTML = `<h1>Live run</h1><p class="lede">No test is running. ${runs.length ? 'Open the latest run or start a new one.' : 'Start a test from "New test".'}</p>${runs[0] ? `<button class="btn" id="open-last">Open ${esc(runs[0].name)}</button>` : ''}`;
        const open = $('#open-last'); if (open) open.addEventListener('click', () => { state.runId = runs[0].id; renderLive(); });
        return;
      }
    }
    const tick = async () => {
      let data; try { data = await api(`/runs/${state.runId}/live`); } catch (error) { return; }
      drawLive(root, data);
      const active = ACTIVE.includes(data.meta.state);
      $('#live-dot').classList.toggle('hidden', !active);
      if (!active) { clearInterval(state.poll); state.meta.activeRun = null; }
    };
    await tick(); state.poll = setInterval(() => { if (state.tab === 'live') tick(); }, 1000);
  }

  function drawLive(root, { meta, live, log }) {
    const active = ACTIVE.includes(meta.state);
    const l = live; const total = l && l.total;
    const plan = l && l.plan;
    const series = (l && l.series) || [];
    const pct = l && l.durationSeconds ? Math.min(100, (l.elapsedSeconds / l.durationSeconds) * 100) : 0;
    const res = l && l.resources;
    const target = res && res.target;
    root.innerHTML = `<div class="row" style="justify-content:space-between"><div><h1>${esc(meta.name)}</h1><p class="muted small">${esc(meta.id)} · seed <code>${esc(meta.seed)}</code> · ${esc(meta.environment)}</p></div>
      <div class="row">${badge(meta.state, STATE_TEXT[meta.state])}${active ? '<button class="btn danger" id="cancel-run">Cancel test</button>' : `<button class="btn" id="open-report">Open report</button><button class="btn" id="to-history">All reports</button>`}</div></div>
      ${meta.stateReason ? `<div class="msg ${meta.state === 'completed' ? 'ok' : 'err'}">${esc(meta.stateReason)}</div>` : ''}
      ${l ? `<div class="progress" aria-label="Progress"><i style="width:${pct}%"></i></div>
      <p class="small muted">${esc(l.stage)} · elapsed ${dur(l.elapsedSeconds)} · remaining about ${dur(l.remainingSeconds)} (plus up to ${plan ? plan.gracefulStopSeconds : 30}s cool-down)</p>
      <div class="grid g6">
        <div class="kpi"><b>${fmt(l.currentVus, 0)} / ${fmt(l.targetVus, 0)}</b><span>users now / target</span></div>
        <div class="kpi"><b>${fmt(l.rpsRecent, 1)}</b><span>requests/s (last 10s)</span></div>
        <div class="kpi"><b>${fmt(total.requests, 0)}</b><span>total requests</span></div>
        <div class="kpi"><b>${fmt(total.requests - total.failed, 0)}</b><span>successful</span></div>
        <div class="kpi"><b class="${total.failed ? 'error' : ''}">${fmt(total.failed, 0)}</b><span>failed</span></div>
        <div class="kpi"><b class="${l.errorRateRecentPct > 1 ? 'error' : ''}">${fmt(total.errorRatePct, 2)}%</b><span>error rate (run) · ${fmt(l.errorRateRecentPct, 2)}% recent</span></div>
        <div class="kpi"><b>${ms(total.latencyMs.avg)}</b><span>average</span></div><div class="kpi"><b>${ms(total.latencyMs.p50)}</b><span>median</span></div>
        <div class="kpi"><b>${ms(total.latencyMs.p90)}</b><span>p90</span></div><div class="kpi"><b>${ms(total.latencyMs.p95)}</b><span>p95</span></div>
        <div class="kpi"><b>${ms(total.latencyMs.p99)}</b><span>p99</span></div><div class="kpi"><b>${fmt(total.timeouts, 0)}</b><span>timeouts</span></div>
      </div>
      ${l.violations.length ? `<div class="msg err"><b>Threshold violations right now:</b> ${l.violations.map(v => `${esc(v.label)} ${fmt(v.actual, 2)} ${esc(v.unit)} (limit ${v.limit})`).join('; ')}</div>` : ''}
      ${l.abortStreak > 0 ? `<div class="msg warn">Safety check: error rate has been over the abort limit for ${l.abortStreak}s.</div>` : ''}
      <div class="grid g2"><div class="card"><h3>Users: configured vs active</h3><div class="chart">${LTCharts.lineChart({ height: 200, yTitle: 'users', series: [{ name: 'Configured', color: LTCharts.COLORS.grey, dash: '5 4', data: series.map(p => [p.t, plan ? targetAt(plan, p.t) : null]) }, { name: 'Active', color: LTCharts.COLORS.green, area: true, data: series.map(p => [p.t, p.vus]) }] })}</div></div>
      <div class="card"><h3>Requests per second</h3><div class="chart">${LTCharts.lineChart({ height: 200, yTitle: 'req/s', series: [{ name: 'Requests/s', color: LTCharts.COLORS.green, area: true, data: series.map(p => [p.t, p.requests]) }, { name: 'Failed/s', color: LTCharts.COLORS.red, data: series.map(p => [p.t, p.failed]) }] })}</div></div>
      <div class="card"><h3>Response time</h3><div class="chart">${LTCharts.lineChart({ height: 200, yTitle: 'ms', series: [{ name: 'Average', color: LTCharts.COLORS.lime, data: series.map(p => [p.t, p.avg]) }, { name: 'p95', color: LTCharts.COLORS.coral, data: series.map(p => [p.t, p.p95]) }, { name: 'p99', color: LTCharts.COLORS.purple, data: series.map(p => [p.t, p.p99]) }] })}</div></div>
      <div class="card"><h3>HTTP status codes</h3><div class="chart">${LTCharts.barChart({ labelWidth: 100, items: Object.entries(l.statuses || {}).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([code, n]) => ({ label: code === '0' ? 'No response' : `HTTP ${code}`, value: n, color: code === '0' || Number(code) >= 500 ? LTCharts.COLORS.red : Number(code) >= 400 ? LTCharts.COLORS.amber : LTCharts.COLORS.green })) })}</div></div></div>
      <div class="card"><h3>Server resources</h3>${target ? `<div class="grid g6"><div class="kpi"><b>${fmt(target.cpuPct, 0)}%</b><span>API CPU (of one core)</span></div><div class="kpi"><b>${fmt(target.rssMb, 0)} MB</b><span>API memory</span></div>
        <div class="kpi"><b>${fmt(target.eventLoopLagMs.p99, 0)} ms</b><span>event-loop lag p99</span></div><div class="kpi"><b>${target.pool ? `${target.pool.inUse}/${target.pool.limit}` : 'n/a'}</b><span>DB connections in use</span></div>
        <div class="kpi"><b>${fmt(target.dbPingMs, 1)} ms</b><span>DB round-trip (SELECT 1)</span></div><div class="kpi"><b>${fmt(res.system.cpuPct, 0)}%</b><span>machine CPU</span></div></div>` : `<p class="muted small">API metrics are not collected for this environment or have not arrived yet.${res ? ` Machine CPU ${fmt(res.system.cpuPct, 0)}%.` : ''}</p>`}</div>
      <div class="grid g2"><div class="card"><h3>Journeys</h3><div class="scroll"><table><thead><tr><th>Scenario</th><th class="n">Started</th><th class="n">Done</th><th class="n">Failed</th></tr></thead><tbody>${l.journeys.map(j => `<tr><td>${esc(j.id)}</td><td class="n">${j.started}</td><td class="n">${j.completed}</td><td class="n">${j.failed}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No journeys yet</td></tr>'}</tbody></table></div></div>
      <div class="card"><h3>Endpoints</h3><div class="scroll"><table><thead><tr><th>Endpoint</th><th class="n">Req</th><th class="n">Avg</th><th class="n">p95</th><th class="n">Err</th></tr></thead><tbody>${l.endpoints.map(e => `<tr><td>${esc(e.name)}</td><td class="n">${e.requests}</td><td class="n">${ms(e.avg)}</td><td class="n">${ms(e.p95)}</td><td class="n">${e.failed}</td></tr>`).join('')}</tbody></table></div></div></div>` : '<p class="muted">Preparing the target and test data…</p>'}
      <div class="card"><h3>Event log</h3><div class="logbox">${esc((log || []).join('\n'))}</div></div>`;
    const cancel = $('#cancel-run'); if (cancel) cancel.addEventListener('click', async () => { if (!confirm('Stop this test? A partial report will be written.')) return; try { const r = await api(`/runs/${state.runId}/cancel`, { method: 'POST' }); toast(r.message); } catch (error) { toast(error.message); } });
    const rep = $('#open-report'); if (rep) rep.addEventListener('click', () => openReport(meta.id, meta.name));
    const hist = $('#to-history'); if (hist) hist.addEventListener('click', () => setTab('history'));
  }

  // ------------------------------------------------------------------ HISTORY
  async function openReport(id, name) {
    try { const blob = await api(`/runs/${id}/report.html`); $('#viewer-frame').src = URL.createObjectURL(blob); $('#viewer-title').textContent = name; $('#viewer').classList.remove('hidden'); } catch (error) { toast(error.message); }
  }
  $('#viewer-close').addEventListener('click', () => { $('#viewer').classList.add('hidden'); $('#viewer-frame').src = 'about:blank'; });

  async function renderHistory() {
    const root = $('#tab-history');
    state.history = await api('/runs').catch(() => []);
    root.innerHTML = `<h1>Reports &amp; history</h1><p class="lede">Every run is stored with its configuration and seed, so you can repeat it or compare it with another run.</p>
      <div class="card scroll"><table><thead><tr><th>Date</th><th>Name</th><th>State</th><th>Users</th><th>Length</th><th class="n">Requests</th><th class="n">Req/s</th><th class="n">p95</th><th class="n">Errors</th><th>Limits</th><th></th></tr></thead><tbody>
      ${state.history.map(r => `<tr><td>${esc(new Date(r.createdAt).toLocaleString())}</td><td><b>${esc(r.name)}</b><br><span class="small muted">${esc(r.id)} · seed ${esc(r.seed)}</span></td><td>${badge(r.state, STATE_TEXT[r.state])}${r.complete === false && r.state === 'completed' ? '<br><span class="small muted">partial</span>' : ''}</td>
        <td>${esc(r.maxVus || '')}</td><td>${r.durationSeconds ? dur(r.durationSeconds) : ''}</td><td class="n">${r.headline ? fmt(r.headline.requests, 0) : ''}</td><td class="n">${r.headline ? fmt(r.headline.avgRps, 1) : ''}</td><td class="n">${r.headline ? ms(r.headline.p95) : ''}</td><td class="n">${r.headline ? `${fmt(r.headline.errorRatePct, 2)}%` : ''}</td>
        <td>${r.thresholdStatus ? badge(r.thresholdStatus === 'pass' ? 'pass' : r.thresholdStatus === 'fail' ? 'fail' : 'incomplete', r.thresholdStatus) : ''}</td>
        <td><div class="row">${ACTIVE.includes(r.state) ? `<button class="btn small" data-act="live" data-id="${r.id}">Live</button>` : `<button class="btn small" data-act="open" data-id="${r.id}" data-name="${esc(r.name)}">Report</button>
          <select class="btn small" data-act="download" data-id="${r.id}" aria-label="Download"><option value="">Download…</option><option value="report.html">HTML</option><option value="report.pdf">PDF</option><option value="report.json">JSON</option><option value="report.csv?kind=summary">CSV: summary</option><option value="report.csv?kind=endpoints">CSV: endpoints</option><option value="report.csv?kind=scenarios">CSV: scenarios</option><option value="report.csv?kind=timeseries">CSV: time series</option></select>
          <button class="btn small" data-act="compare" data-id="${r.id}">Compare</button><button class="btn small" data-act="repeat" data-id="${r.id}">Repeat</button><button class="btn small" data-act="delete" data-id="${r.id}">Delete</button>`}</div></td></tr>`).join('') || '<tr><td colspan="11" class="muted">No runs yet.</td></tr>'}</tbody></table></div>`;
    root.onclick = async event => {
      const el = event.target.closest('[data-act]'); if (!el || el.tagName === 'SELECT') return; const id = el.dataset.id;
      if (el.dataset.act === 'open') openReport(id, el.dataset.name);
      if (el.dataset.act === 'live') { state.runId = id; setTab('live'); }
      if (el.dataset.act === 'compare') { state.compareCurrent = id; setTab('compare'); }
      if (el.dataset.act === 'repeat') { const data = await api(`/runs/${id}`); state.config = mergeInto(clone(state.meta.defaults), clone(data.config)); state.config.name = `${data.config.name} (repeat)`; setTab('new'); renderNew(); toast('Configuration and seed loaded'); }
      if (el.dataset.act === 'delete' && confirm('Delete this run and its report?')) { try { await api(`/runs/${id}`, { method: 'DELETE' }); renderHistory(); } catch (error) { toast(error.message); } }
    };
    root.onchange = async event => {
      const el = event.target.closest('select[data-act="download"]'); if (!el || !el.value) return;
      const what = el.value; el.value = ''; const base = what.split('?')[0]; const kind = (what.match(/kind=(\w+)/) || [])[1];
      try { await download(`/runs/${el.dataset.id}/${what}`, `${el.dataset.id}${kind ? `-${kind}` : ''}.${base.split('.')[1]}`); } catch (error) { toast(error.message); }
    };
  }

  // ------------------------------------------------------------------ COMPARE
  async function renderCompare() {
    const root = $('#tab-compare');
    const runs = (await api('/runs').catch(() => [])).filter(r => r.state === 'completed' || r.headline);
    const options = selected => runs.map(r => `<option value="${r.id}" ${r.id === selected ? 'selected' : ''}>${esc(new Date(r.createdAt).toLocaleString())} · ${esc(r.name)} · ${esc(r.maxVus)} users · ${esc(r.state)}</option>`).join('');
    const current = state.compareCurrent || (runs[0] && runs[0].id);
    root.innerHTML = `<h1>Compare runs</h1><p class="lede">Pick an earlier run as the baseline and a newer run to check. The comparison first decides whether the two runs are comparable (same environment, similar load and workload) and only then judges each metric.</p>
      <div class="card"><div class="grid g3"><div class="field"><label>Baseline<select id="cmp-base"><option value="">(choose)</option>${options('')}</select></label></div><div class="field"><label>Current run<select id="cmp-cur">${options(current)}</select></label></div>
      <div class="field"><label>&nbsp;</label><div class="row"><button class="btn primary" id="cmp-go">Compare</button><button class="btn" id="cmp-auto">Compare with latest comparable run</button></div></div></div></div><div id="cmp-result"></div>`;
    const run = async auto => {
      const cur = $('#cmp-cur').value; const base = $('#cmp-base').value;
      if (!cur || (!auto && !base)) { toast('Choose a baseline and a current run'); return; }
      try { const data = await api(`/compare?current=${cur}${auto ? '' : `&baseline=${base}`}`); drawComparison(data); } catch (error) { $('#cmp-result').innerHTML = `<div class="msg err">${esc(error.message)}</div>`; }
    };
    $('#cmp-go').onclick = () => run(false); $('#cmp-auto').onclick = () => run(true);
    if (state.compareCurrent) { state.compareCurrent = null; run(true); }
  }

  function drawComparison(c) {
    const out = $('#cmp-result');
    if (c.none) { out.innerHTML = `<div class="msg warn">${esc(c.message)}</div>`; return; }
    const v = c.comparability.verdict;
    const cell = m => `<tr><td>${esc(m.label || m.name)}</td><td class="n">${fmt(m.baseline, 2)} ${esc(m.unit || '')}</td><td class="n">${fmt(m.current, 2)} ${esc(m.unit || '')}</td><td class="n">${m.abs === null || m.abs === undefined ? 'n/a' : `${m.abs > 0 ? '+' : ''}${fmt(m.abs, 2)}`}</td><td class="n">${m.pct === null || m.pct === undefined ? 'n/a' : `${m.pct > 0 ? '+' : ''}${fmt(m.pct, 1)}%`}</td><td>${badge(m.classification, CLASS_TEXT[m.classification])}${m.caution ? ' <span class="small muted">caution</span>' : ''}${m.note ? `<br><span class="small muted">${esc(m.note)}</span>` : ''}</td></tr>`;
    const head = '<thead><tr><th>Metric</th><th class="n">Baseline</th><th class="n">Current</th><th class="n">Difference</th><th class="n">%</th><th>Assessment</th></tr></thead>';
    out.innerHTML = `<div class="card"><div class="row">${badge(v === 'comparable' ? 'pass' : v === 'caution' ? 'caution' : 'fail', v === 'comparable' ? 'Comparable' : v === 'caution' ? 'Interpret with caution' : 'Not directly comparable')}<b>${esc(c.verdictText)}</b></div>
      <p class="small muted">Baseline <code>${esc(c.baselineId)}</code> (${esc(c.baselineName)}) → current <code>${esc(c.currentId)}</code> (${esc(c.currentName)}). Tolerances: latency ±${c.rules.latencyPct}% (changes under ${c.rules.minAbsLatencyMs} ms ignored), error rate ±${c.rules.errorRatePp} points, throughput −${c.rules.throughputDropPct}%.</p>
      ${c.comparability.reasons.map(r => `<div class="msg ${r.level === 'not_comparable' ? 'err' : r.level === 'caution' ? 'warn' : ''}"><b>${esc(r.level === 'info' ? 'Note' : r.level === 'caution' ? 'Caution' : 'Not comparable')}:</b> ${esc(r.note)}</div>`).join('')}</div>
      <div class="card scroll"><h3>Headline metrics</h3><table>${head}<tbody>${c.metrics.map(cell).join('')}</tbody></table></div>
      ${c.endpoints.length ? `<div class="card scroll"><h3>Endpoints (p95)</h3><table>${head}<tbody>${c.endpoints.map(e => cell({ ...e.p95, label: e.name })).join('')}</tbody></table></div>` : ''}
      ${c.journeys.length ? `<div class="card scroll"><h3>Scenarios (request p95)</h3><table>${head}<tbody>${c.journeys.map(j => cell({ ...j.p95, label: j.id })).join('')}</tbody></table></div>` : ''}
      ${c.resources.length ? `<div class="card scroll"><h3>Resources</h3><table>${head}<tbody>${c.resources.map(cell).join('')}</tbody></table></div>` : '<div class="msg">Resource utilisation was not collected in both runs, so it is not compared.</div>'}
      <button class="btn" id="cmp-json">Download comparison (JSON)</button>`;
    $('#cmp-json').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(c, null, 2)], { type: 'application/json' })); a.download = `compare-${c.baselineId}-vs-${c.currentId}.json`; a.click(); };
  }

  // ------------------------------------------------------------------ start up
  async function start() {
    state.meta = await api('/meta');
    $('#gate').classList.add('hidden'); $('#app').classList.remove('hidden');
    if (!state.config) { state.config = clone(state.meta.defaults); state.config.seed = newSeed(); }
    const e = state.meta.engine; $('#engine-note').textContent = e.installed ? `Engine: ${e.version}` : 'Engine: k6 not installed';
    $('#live-dot').classList.toggle('hidden', !state.meta.activeRun);
    if (state.meta.activeRun) { state.runId = state.meta.activeRun.id; }
    renderNew();
    setTab(state.meta.activeRun ? 'live' : 'new');
  }
  if (state.token) start().catch(() => showGate('')); else showGate('');
})();
