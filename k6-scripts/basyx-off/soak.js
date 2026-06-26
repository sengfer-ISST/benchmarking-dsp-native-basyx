// BaSyx identity-OFF — SOAK / ENDURANCE (RQ3 stability). OFF counterpart of
// ../scenarios/soak.js: identical sustained constant-arrival-rate over a long
// window; body is the raw-DSP mock-token driver (runDspFlow). Watch
// jvm_memory_used_bytes drift and GC in the Prometheus snapshot / Grafana.
//
// Run: k6 run -e CONNECTOR=basyx -e IDENTITY_MODE=off basyx-off/soak.js
import { baseOptions } from '../lib/options.js';
import { buildSummary } from '../lib/metrics.js';
import { runDspFlow } from './dsp-flow.js';

export const options = Object.assign({}, baseOptions, {
  scenarios: {
    soak: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.RATE || 3),
      timeUnit: '1s',
      duration: __ENV.DURATION || '1h',
      preAllocatedVUs: Number(__ENV.PREALLOCATED_VUS || 50),
      maxVUs: Number(__ENV.MAX_VUS || 200),
      tags: { scenario: 'soak' },
    },
  },
  thresholds: {
    'dsp_transaction_failed_rate': ['rate<0.02'],
    'e2e_transaction_duration': ['p(95)<20000'],
  },
});

export default function () { runDspFlow(); }
export const handleSummary = buildSummary;
