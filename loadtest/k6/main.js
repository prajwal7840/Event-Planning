// k6 entry point. Launched by loadtest/worker/runner.js with the run configuration in the environment.
// A virtual user is one simulated person: it logs in once, then repeatedly picks a journey that fits its role
// (weighted, seeded), performs a random number of actions with think time between them, and moves on.
import { sleep } from 'k6';
import { CONFIG, getVu, login, think, scenarioStarted, scenarioCompleted, scenarioFailed, scenarioDuration, journeyActions } from './runtime.js';
import { SCENARIO_STEPS, negativeStep } from './journeys.js';

const { planStages, k6Stages } = require('../shared/stages.js');
const plan = planStages(CONFIG);

export const options = {
  scenarios: {
    gather: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: k6Stages(plan),
      gracefulRampDown: `${plan.gracefulStopSeconds}s`,
      gracefulStop: `${plan.gracefulStopSeconds}s`
    }
  },
  userAgent: 'gather-loadtest/1.0',
  systemTags: ['status', 'method', 'scenario', 'error', 'error_code', 'expected_response', 'name'],
  discardResponseBodies: false,
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max']
};

function buildSteps(vu, scenarioId) {
  const rng = vu.rng;
  const included = SCENARIO_STEPS[scenarioId]().filter(step => step.optional === undefined || rng.chance(step.optional));
  const ordered = [];
  for (let i = 0; i < included.length;) {
    const group = included[i].shuffle;
    if (!group) { ordered.push(included[i]); i += 1; continue; }
    let j = i;
    while (j < included.length && included[j].shuffle === group) j += 1;
    rng.shuffle(included.slice(i, j)).forEach(step => ordered.push(step)); // independent reads can come in any order
    i = j;
  }
  let length = rng.int(CONFIG.journey.minActions, CONFIG.journey.maxActions);
  if (rng.chance(CONFIG.journey.earlyStopChance)) length = rng.int(1, 2); // some users leave early
  return ordered.slice(0, Math.max(1, length));
}

export default function () {
  const vu = getVu();
  vu.iteration += 1;
  if (!vu.account) { sleep(5); return; }
  if (!vu.token || (vu.iteration % 12 === 0 && vu.rng.chance(0.5))) {
    if (!login(vu)) { scenarioFailed.add(1, { journey: 'session', role: vu.role }); sleep(3 + vu.rng.float(0, 4)); return; }
    think(vu);
  }
  const choice = vu.rng.weighted(vu.eligible);
  if (!choice) { sleep(5); return; }

  const tags = { journey: choice.id, role: vu.role };
  vu.journey = choice.id;
  vu.journeyFailed = false;
  scenarioStarted.add(1, tags);
  const startedAt = Date.now();
  const steps = buildSteps(vu, choice.id);
  let performed = 0;
  for (let i = 0; i < steps.length; i += 1) {
    steps[i].fn(vu);
    performed += 1;
    negativeStep(vu);
    if (i < steps.length - 1) think(vu);
  }
  scenarioDuration.add(Date.now() - startedAt, tags);
  journeyActions.add(performed, tags);
  (vu.journeyFailed ? scenarioFailed : scenarioCompleted).add(1, tags);
  vu.journey = 'idle';
  think(vu);
}
