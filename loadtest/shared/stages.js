// Load profile maths shared by the dashboard preview, the validator and the k6 script.
//
// Duration definition used everywhere in this module:
//   durationSeconds = warm-up + ramp-up + sustained load + ramp-down      (sustained load is whatever remains)
// k6 then allows up to `gracefulStopSeconds` of extra "cool-down" for in-flight journeys to finish; that time is
// NOT part of durationSeconds and is reported separately.
'use strict';

const ROLES = ['HOST', 'VENDOR', 'INVITEE'];

function planStages(config) {
  const maxVus = Math.max(1, Math.round(config.maxVus));
  const warmupSeconds = Math.max(0, Math.round(config.warmupSeconds || 0));
  const rampUpSeconds = Math.max(0, Math.round(config.rampUpSeconds || 0));
  const rampDownSeconds = Math.max(0, Math.round(config.rampDownSeconds || 0));
  const durationSeconds = Math.round(config.durationSeconds);
  const sustainSeconds = durationSeconds - warmupSeconds - rampUpSeconds - rampDownSeconds;
  const warmupVus = warmupSeconds > 0 ? Math.min(maxVus, Math.max(1, Math.round(config.warmupVus || Math.min(5, maxVus)))) : 0;
  const stages = [];
  let cursor = 0;
  const add = (name, seconds, fromVus, toVus) => {
    if (seconds <= 0) return;
    stages.push({ name, startSeconds: cursor, durationSeconds: seconds, fromVus, toVus });
    cursor += seconds;
  };
  add('warm-up', warmupSeconds, 0, warmupVus);
  add('ramp-up', rampUpSeconds, warmupVus, maxVus);
  add('sustained load', Math.max(0, sustainSeconds), maxVus, maxVus);
  add('ramp-down', rampDownSeconds, maxVus, 0);
  return {
    maxVus, warmupVus, durationSeconds, warmupSeconds, rampUpSeconds, rampDownSeconds,
    sustainSeconds, gracefulStopSeconds: config.gracefulStopSeconds || 30, stages,
    sustainStartSeconds: warmupSeconds + rampUpSeconds,
    sustainEndSeconds: warmupSeconds + rampUpSeconds + Math.max(0, sustainSeconds)
  };
}

// The configured number of virtual users at `seconds` into the test (linear between stage boundaries).
function targetAt(plan, seconds) {
  if (seconds < 0) return 0;
  for (const stage of plan.stages) {
    if (seconds <= stage.startSeconds + stage.durationSeconds) {
      const fraction = (seconds - stage.startSeconds) / stage.durationSeconds;
      return Math.round(stage.fromVus + (stage.toVus - stage.fromVus) * fraction);
    }
  }
  return 0;
}

function stageAt(plan, seconds) {
  for (const stage of plan.stages) if (seconds < stage.startSeconds + stage.durationSeconds) return stage.name;
  return 'finished';
}

// k6 `ramping-vus` stages. Every stage is linear from the previous target.
function k6Stages(plan) {
  return plan.stages.map(stage => ({ duration: `${stage.durationSeconds}s`, target: stage.toVus }));
}

// Points for the "expected load progression" chart: [[seconds, vus], ...]
function previewSeries(plan, points) {
  const count = points || 120;
  const series = [];
  for (let i = 0; i <= count; i += 1) {
    const t = (plan.durationSeconds * i) / count;
    series.push([Math.round(t), targetAt(plan, t)]);
  }
  return series;
}

module.exports = { ROLES, planStages, targetAt, stageAt, k6Stages, previewSeries };
