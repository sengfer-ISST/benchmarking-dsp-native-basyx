// BaSyx identity-OFF smoke — the gate for the raw-DSP mock-token arm. OFF
// counterpart of ../scenarios/smoke.js: SAME executor (1 VU, 5 sequential
// iterations), SAME thresholds, SAME summary (buildSummary -> k6-summary.json),
// only the iteration body is the raw-DSP driver (runDspFlow) instead of the
// EDC-Management-API runTransaction — so smoke artifacts are comparable ON<->OFF.
//
// Proves the full DSP cycle (catalog -> negotiation -> verification -> transfer ->
// data pull) completes against the mock provider WITHOUT any credential: the only
// auth presented is the plain-JSON {clientId,audience} mock token. A green run here
// is the evidence that identity verification is genuinely bypassed.
//
// Run via the orchestrator (warmup + Prometheus snapshot + meta.json):
//   SCENARIO_DIR=basyx-off ./orchestration/run.sh basyx smoke
//
// NOTE: this entrypoint is OFF-only and lives outside scenarios/ on purpose; the
// shared scenarios/ drive the EDC Management API and serve the ON (mvd) arm.

import { check } from 'k6';
import { baseOptions } from '../lib/options.js';
import { buildSummary } from '../lib/metrics.js';
import { runDspFlow } from './dsp-flow.js';
import { seedShell } from './seed.js';

export const options = Object.assign({}, baseOptions, {
  scenarios: {
    smoke: {
      executor: 'per-vu-iterations',
      vus: 1,
      iterations: Number(__ENV.ITERATIONS || 5),
      maxDuration: '5m',
      tags: { scenario: 'smoke' },
    },
  },
  thresholds: {
    // Mirrors ../scenarios/smoke.js (see the rate-vs-counter note there).
    'dsp_transaction_failed_rate': ['rate<0.01'],    // every transaction must complete
    'e2e_transaction_duration': ['p(95)<10000'],     // generous single-user bound
    'checks': ['rate==1.0'],                         // every DSP step must pass (bypass evidence)
  },
});

// Self-seed the pinned shell so the pull has a target (Mongo isn't persistent).
export function setup() {
  const r = seedShell();
  console.log('seed: ' + JSON.stringify(r));
  return r;
}

export default function () {
  const r = runDspFlow();

  check(r, {
    'catalog returned an asset+offer': (r) => r.catalog && r.catalog.ok,
    'negotiation acked (providerPid)': (r) => r.negotiate && r.negotiate.ok && !!r.negotiate.providerPid,
    'agreement verified (contractId)': (r) => r.verify && r.verify.ok && !!r.verify.contractId,
    'transfer acked': (r) => r.transfer && r.transfer.ok,
    'EDR received (endpoint+token)': (r) => r.edr && r.edr.ok,
    'data pulled (200)': (r) => r.pull && r.pull.ok,
  });

  // Surface where it stopped if a step failed (visible in k6 console output).
  if (!r.pull || !r.pull.ok) {
    console.log('OFF smoke incomplete — last result: ' + JSON.stringify(r));
  }
}

export const handleSummary = buildSummary;
