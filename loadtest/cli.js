// Command-line runner (same engine as the dashboard).
//   node loadtest/cli.js --preset smoke --confirm managed-local
//   node loadtest/cli.js --config my-test.json --vus 50 --duration 300 --seed abc123 --confirm managed-local
//   node loadtest/cli.js --plan --preset load          (print the expected load progression only)
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { validateConfig, deepMerge, loadPresets, loadEnvironments } = require('./lib/config');
const { scenarioAvailability } = require('./lib/availability');
const storage = require('./lib/storage');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    args[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i += 1] : true;
  }
  return args;
}

function buildConfig(args) {
  let input = {};
  if (args.preset) {
    const preset = loadPresets()[args.preset];
    if (!preset) throw new Error(`Unknown preset "${args.preset}". Available: ${Object.keys(loadPresets()).join(', ')}`);
    input = deepMerge(input, preset.config);
  }
  if (args.config) input = deepMerge(input, JSON.parse(fs.readFileSync(path.resolve(args.config), 'utf8')));
  if (args.vus) input.maxVus = Number(args.vus);
  if (args.duration) input.durationSeconds = Number(args.duration);
  if (args.seed) input.seed = String(args.seed);
  if (args.name) input.name = String(args.name);
  if (args.environment) input.environment = String(args.environment);
  return input;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.preset && !args.config)) {
    console.log('Usage: node loadtest/cli.js (--preset smoke|load|stress|soak | --config file.json) [--vus N] [--duration SECONDS] [--seed S] [--name TEXT] --confirm <environment>\n       add --plan to preview the load progression without running');
    console.log(`Environments: ${Object.keys(loadEnvironments()).join(', ')}`);
    return;
  }
  const { unavailable } = scenarioAvailability();
  const checked = validateConfig(buildConfig(args), { unavailable, requireConfirmation: !args.plan, confirmEnvironment: args.confirm });
  checked.warnings.forEach(w => console.log(`warning: ${w}`));
  if (!checked.valid) { checked.errors.forEach(e => console.error(`error: ${e}`)); process.exit(2); }
  const { plan, config } = checked;
  console.log(`Plan: ${plan.stages.map(s => `${s.name} ${s.durationSeconds}s (${s.fromVus}->${s.toVus} users)`).join(' | ')}`);
  console.log(`Accounts to seed: ${JSON.stringify(checked.accounts)}  seed=${config.seed}`);
  if (args.plan) return;

  const meta = storage.createRun(config);
  console.log(`Run ${meta.id} created. Starting worker...`);
  const worker = spawn(process.execPath, [path.join(__dirname, 'worker/run-worker.js'), meta.id], { stdio: 'inherit' });
  let last = '';
  const watcher = setInterval(() => {
    const live = storage.readLive(meta.id);
    if (!live) return;
    const line = `${live.state.padEnd(12)} ${String(live.elapsedSeconds).padStart(6)}s  users ${String(live.currentVus).padStart(4)}/${live.targetVus}  ${String(live.rpsRecent).padStart(7)} req/s  p95 ${live.latencyRecentMs.p95 ?? '-'} ms  errors ${live.errorRateRecentPct}%`;
    if (line !== last) { console.log(line); last = line; }
  }, 5000);
  await new Promise(resolve => worker.on('close', resolve));
  clearInterval(watcher);
  const final = storage.readMeta(meta.id);
  console.log(`\nRun ${final.id}: ${final.state}${final.stateReason ? ` (${final.stateReason})` : ''}; thresholds: ${final.thresholdStatus || 'n/a'}`);
  if (final.headline) console.log(`Requests ${final.headline.requests}, ${final.headline.avgRps} req/s, p95 ${final.headline.p95} ms, error rate ${final.headline.errorRatePct}%, peak users ${final.headline.peakVus}`);
  console.log(`Report: ${storage.reportPath(meta.id, 'report.html')}`);
  process.exit(final.state === 'completed' ? 0 : 1);
}

main().catch(error => { console.error(error.message); process.exit(2); });
