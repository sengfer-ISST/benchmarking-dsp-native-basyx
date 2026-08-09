// BaSyx identity-OFF — POLL-INTERVAL SENSITIVITY. OFF counterpart of
// ../scenarios/poll-sensitivity.js: the load profile is identical to steady.js in
// this same directory, and the poll interval is the only variable.
//
// WHAT IT MEASURES HERE, AND WHY IT DIFFERS FROM THE ON ARM. In the ON arm the
// harness polls the EDC consumer control plane, so its polls land on a JVM that is
// part of the system under test. In this arm there is no EDC consumer: the
// provider pushes state to the callback sink and k6 polls the sink instead, so the
// poll load lands on a small Node process outside the system under test. The
// expected result is therefore that varying the interval changes almost nothing,
// and that expectation is worth confirming rather than assuming — it is the
// evidence that the two arms' poll loads are not comparable, which is exactly why
// the client-side G1-G2 difference for BaSyx cannot be read as identity overhead.
//
// Run: POLL_INTERVAL_MS=1000 ./orchestration/run.sh basyx poll-sensitivity
import { baseOptions } from '../lib/options.js';
import { buildSummary } from '../lib/metrics.js';
import { runDspFlow } from './dsp-flow.js';
import { seedShell } from './seed.js';

export const options = Object.assign({}, baseOptions, {
  scenarios: {
    pollSensitivity: {
      // Must stay identical to basyx-off/steady.js, which must stay identical to
      // ../scenarios/steady.js. Three copies of one load profile; change all three.
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.RATE || 1),
      timeUnit: '1s',
      duration: __ENV.DURATION || '5m',
      preAllocatedVUs: Number(__ENV.PREALLOCATED_VUS || 50),
      maxVUs: Number(__ENV.MAX_VUS || 200),
      tags: { scenario: 'poll-sensitivity' },
    },
  },
  thresholds: {
    // No failure gate — a long poll interval legitimately pushes transactions past
    // the deadline, and that is the observation, not a defect. Mirrors the ON arm.
    'dropped_iterations': ['count<1'],
  },
});

export function setup() { return seedShell(); }
export default function () { runDspFlow(); }
export const handleSummary = buildSummary;
