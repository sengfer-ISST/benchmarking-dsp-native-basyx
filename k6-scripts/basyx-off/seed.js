// Idempotent provider seeding for the BaSyx identity-OFF arm.
//
// WHY: the BaSyx provider has no Management API — its data lives in MongoDB, which
// has no persistent volume in the mock compose, so a stack restart wipes it. A
// consumer-PULL needs at least one REGULAR shell DataAsset (the *ApiAsset catalog
// entries are write-proxies, not GET-readable). This seeds the pinned shell
// (id == off.assetIdSelector, so the driver targets exactly what we seed) once per
// k6 test in setup(), making every OFF run self-contained and restart-proof.
//
// Mirrors fx-bruno/transactions/dsp-native AAS provider/: Keycloak password grant
// -> POST /shells. Idempotent: 201 (created) and 409 (already exists) both pass.

import http from 'k6/http';
import { CONFIG } from '../lib/config.js';

const OFF = CONFIG.off;

export function seedShell() {
  const s = OFF.seed;
  if (!s || !s.enabled) return { seeded: false, reason: 'off.seed.enabled=false' };

  // 1. Keycloak admin token (password grant). An object body => form-urlencoded.
  const tokenRes = http.post(s.keycloakTokenUrl, {
    client_id: s.keycloakClientId,
    grant_type: 'password',
    username: s.keycloakUsername,
    password: s.keycloakPassword,
  });
  if (tokenRes.status !== 200) {
    return { seeded: false, reason: 'keycloak token failed', status: tokenRes.status };
  }
  const accessToken = tokenRes.json('access_token');

  // 2. POST the pinned shell. id == assetIdSelector so the driver selects it.
  const shellId = OFF.assetIdSelector;
  const shell = {
    modelType: 'AssetAdministrationShell',
    assetInformation: {
      assetKind: 'Instance',
      assetType: 'Car',
      globalAssetId: s.globalAssetId || 'urn:uuid:580d3adf-1981-44a0-a214-13d6ceed9379',
    },
    id: shellId,
    idShort: s.idShort || 'Car',
  };
  const r = http.post(s.shellsUrl, JSON.stringify(shell), {
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + accessToken },
  });
  // 201 created / 409 conflict (already seeded) / 200-204 all count as success.
  const ok = r.status === 201 || r.status === 409 || r.status === 200 || r.status === 204;
  return { seeded: ok, status: r.status, shellId };
}
