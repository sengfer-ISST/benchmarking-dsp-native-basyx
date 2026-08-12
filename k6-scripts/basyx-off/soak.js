// BaSyx identity-OFF — SOAK / ENDURANCE (RQ3 stability). OFF counterpart of
// ../scenarios/soak.js: identical sustained constant-arrival-rate over a long
// window; body is the raw-DSP mock-token driver (runDspFlow). Watch
// jvm_memory_used_bytes drift and GC in the Prometheus snapshot / Grafana.
//
// Run: k6 run -e CONNECTOR=basyx -e IDENTITY_MODE=off basyx-off/soak.js
import { baseOptions } from '../lib/options.js';
import { buildSummary } from '../lib/metrics.js';
import { runDspFlow } from './dsp-flow.js';
import { seedShell } from './seed.js';

export const options = Object.assign({}, baseOptions, {
  scenarios: {
    soak: {
      executor: 'constant-arrival-rate',
      // 1 per 2s, NOT 0.5 per 1s — k6's `rate` is an int64 and a fractional value is
      // rejected while parsing options, before the script runs. Mirrors ../scenarios/soak.js.
      rate: Number(__ENV.RATE || 1),
      timeUnit: __ENV.TIME_UNIT || '2s',
      duration: __ENV.DURATION || '30m',
      preAllocatedVUs: Number(__ENV.PREALLOCATED_VUS || 50),
      maxVUs: Number(__ENV.MAX_VUS || 200),
      tags: { scenario: 'soak' },
    },
  },
  thresholds: {
    // VALIDITY GATE (mirrors ../scenarios/): a dropped iteration means k6 could not
    // start a scheduled transaction, so the offered rate was not delivered and the
    // run does not describe its nominal load. Must match the ON arm or X1 compares
    // runs judged by different standards.
    'dropped_iterations': ['count<1'],
    'dsp_transaction_failed_rate': ['rate<0.02'],
    'e2e_transaction_duration': ['p(95)<20000'],
  },
});

// Self-seed the pinned shell once per test (Mongo isn't persistent).
export function setup() { return seedShell(); }
export default function () { runDspFlow(); }
export const handleSummary = buildSummary;
