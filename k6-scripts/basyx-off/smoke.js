// BaSyx identity-OFF smoke — the gate for the raw-DSP mock-token arm.
//
// Proves the full DSP cycle (catalog -> negotiation -> verification -> transfer ->
// data pull) completes against the mock provider WITHOUT any credential: the only
// auth presented is the plain-JSON {clientId,audience} mock token. A green run here
// is the evidence that identity verification is genuinely bypassed.
//
// Run (after `docker compose -f docker-compose-mock.monitoring.yaml up -d` and the
// AAS data is seeded — see basyx-off/README.md):
//   k6 run -e CONNECTOR=basyx -e IDENTITY_MODE=off basyx-off/smoke.js
//
// NOTE: this entrypoint is OFF-only and lives outside scenarios/ on purpose; the
// shared scenarios/ drive the EDC Management API and serve the ON (mvd) arm.

import { check } from 'k6';
import { runDspFlow } from './dsp-flow.js';

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: {
    checks: ['rate==1.0'], // every step must pass for the smoke to be a valid gate
  },
};

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
