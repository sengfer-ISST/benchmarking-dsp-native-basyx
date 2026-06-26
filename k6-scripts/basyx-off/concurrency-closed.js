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

const STAGE = __ENV.STAGE_DURATION || '2m';

export const options = Object.assign({}, baseOptions, {
  scenarios: {
    concurrency: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { target: 10, duration: STAGE },
        { target: 50, duration: STAGE },
        { target: 100, duration: STAGE },
        { target: Number(__ENV.MAX_VUS || 200), duration: STAGE },
        { target: Number(__ENV.MAX_VUS || 200), duration: STAGE }, // hold at top
      ],
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
