// BaSyx identity-OFF — SATURATION sweep (RQ2, open model). OFF counterpart of
// ../scenarios/saturation-open.js: identical ramping-arrival-rate stages and
// abort-only threshold; body is the raw-DSP mock-token driver (runDspFlow). Read
// the knee from the latency-vs-rate curve, and watch node-exporter — on a small
// host the knee may be the HOST ceiling, not the connector.
//
// Run: k6 run -e CONNECTOR=basyx -e IDENTITY_MODE=off basyx-off/saturation-open.js
import { baseOptions } from '../lib/options.js';
import { buildSummary } from '../lib/metrics.js';
import { runDspFlow } from './dsp-flow.js';
import { seedShell } from './seed.js';

const STAGE = __ENV.STAGE_DURATION || '90s';
// Ladder MUST match ../scenarios/saturation-open.js (same default, same env knob):
// the G1/G2 identity-overhead delta X1 is only meaningful if both arms were offered
// the same load. Legacy ladder was 2,5,10,20,40 -- far above the measured knee.
const RATES = String(__ENV.RATES || '1,2,3,4,5,6')
  .split(',').map((s) => Number(s.trim())).filter((n) => n > 0);
const satStages = RATES.map((r) => ({ target: r, duration: STAGE }));
satStages.push({ target: RATES[RATES.length - 1], duration: STAGE });

export const options = Object.assign({}, baseOptions, {
  scenarios: {
    saturation: {
      executor: 'ramping-arrival-rate',
      startRate: Number(__ENV.START_RATE || 1),
      timeUnit: '1s',
      preAllocatedVUs: Number(__ENV.PREALLOCATED_VUS || 600),
      maxVUs: Number(__ENV.MAX_VUS || 800),
      stages: satStages,
      tags: { scenario: 'saturation' },
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
