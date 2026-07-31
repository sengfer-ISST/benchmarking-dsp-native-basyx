// BaSyx identity-OFF — STEADY-STATE (RQ1). OFF counterpart of ../scenarios/steady.js:
// the load profile (executor/rate/duration/VU pool) and thresholds are IDENTICAL,
// only the iteration body is the raw-DSP mock-token driver (runDspFlow) instead of
// the EDC-Management-API runTransaction. Same metric set => the per-scenario
// ON-OFF delta is the provider-side mvd->mock cost (read within BaSyx).
//
// Run: k6 run -e CONNECTOR=basyx -e IDENTITY_MODE=off basyx-off/steady.js
import { baseOptions } from '../lib/options.js';
import { buildSummary } from '../lib/metrics.js';
import { runDspFlow } from './dsp-flow.js';
import { seedShell } from './seed.js';

export const options = Object.assign({}, baseOptions, {
  scenarios: {
    steady: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.RATE || 2),
      timeUnit: '1s',
      duration: __ENV.DURATION || '5m',
      preAllocatedVUs: Number(__ENV.PREALLOCATED_VUS || 50),
      maxVUs: Number(__ENV.MAX_VUS || 200),
      tags: { scenario: 'steady' },
    },
  },
  thresholds: {
    // VALIDITY GATE (mirrors ../scenarios/): a dropped iteration means k6 could not
    // start a scheduled transaction, so the offered rate was not delivered and the
    // run does not describe its nominal load. Must match the ON arm or X1 compares
    // runs judged by different standards.
    'dropped_iterations': ['count<1'],
    'dsp_transaction_failed_rate': ['rate<0.01'],
    'time_to_agreed': ['p(95)<8000', 'p(99)<15000'],
    'time_to_edr': ['p(95)<8000'],
    'e2e_transaction_duration': ['p(95)<20000'],
  },
});

// Self-seed the pinned shell once per test (Mongo isn't persistent).
export function setup() { return seedShell(); }
export default function () { runDspFlow(); }
export const handleSummary = buildSummary;
