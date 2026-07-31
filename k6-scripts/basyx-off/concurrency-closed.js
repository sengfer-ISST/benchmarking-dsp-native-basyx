// BaSyx identity-OFF — CONCURRENCY sweep (RQ2, closed model). OFF counterpart of
// ../scenarios/concurrency-closed.js: identical ramping-vus stages; body is the
// raw-DSP mock-token driver (runDspFlow). Report ALONGSIDE the open-model
// saturation result; closed model suffers coordinated omission, so treat its tail
// latency as optimistic.
//
// Run: k6 run -e CONNECTOR=basyx -e IDENTITY_MODE=off basyx-off/concurrency-closed.js
import { baseOptions } from '../lib/options.js';
import { buildSummary } from '../lib/metrics.js';
import { runDspFlow } from './dsp-flow.js';
import { seedShell } from './seed.js';

const STAGE = __ENV.STAGE_DURATION || '90s';
// Ladder MUST match ../scenarios/concurrency-closed.js -- see the note there.
const VU_STAGES = String(__ENV.VU_STAGES || '5,10,20,50')
  .split(',').map((s) => Number(s.trim())).filter((n) => n > 0);
const vuStages = VU_STAGES.map((v) => ({ target: v, duration: STAGE }));
vuStages.push({ target: VU_STAGES[VU_STAGES.length - 1], duration: STAGE });

export const options = Object.assign({}, baseOptions, {
  scenarios: {
    concurrency: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: vuStages,
      gracefulStop: '30s',
      tags: { scenario: 'concurrency' },
    },
  },
  thresholds: {
    'dsp_transaction_failed_rate': [{ threshold: 'rate<0.5', abortOnFail: true, delayAbortEval: '1m' }],
  },
});

// Self-seed the pinned shell once per test (Mongo isn't persistent).
export function setup() { return seedShell(); }
export default function () { runDspFlow(); }
export const handleSummary = buildSummary;
