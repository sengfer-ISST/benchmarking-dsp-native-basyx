# BaSyx identity-OFF (mock) arm — raw-DSP driver

This folder drives the **identity-OFF** arm of dsp-native-basyx. It is **separate
from the shared harness** (`../lib/` + `../scenarios/`) on purpose — see *Why this
is separate* below. The shared harness drives the ON (mvd) arm; this driver drives
the OFF (mock) arm.

## Why this is separate (parity deviation — read this)

In the ON arm the provider runs `org.factoryx.library.validationservice=mvd` (full
DCP) and is driven by an **EDC consumer** via its Management API (`:29010`), exactly
like the EDC/Factory-X connectors. The shared harness works there.

In the OFF arm the provider runs `validationservice=mock`. `MockValidationService`
expects a plain-JSON `{clientId,audience}` bearer token — it cannot parse the signed
JWT an EDC DCP consumer emits — so **the EDC consumer is wire-incompatible with the
mock arm** and is absent from `docker-compose-mock.monitoring.yaml`. The OFF arm must
therefore be driven by a consumer that speaks DSP directly with a mock token: this
driver.

Consequence: BaSyx ON and OFF differ on **both** sides (provider validation *and*
consumer driver), unlike the EDC family where only the provider runtime changes. So
the BaSyx **G1−G2 delta is read WITHIN BaSyx** (provider-side `mvd`→`mock` validation
cost), not cross-connector. This is the disclosed construct-validity limitation noted
in the methodology and at the top of the OFF compose. `lib/` + `scenarios/` stay
byte-identical to the canonical harness (they serve the ON arm); this `basyx-off/`
folder is excluded from `verify-parity`.

## Alternatives considered & future migration path

We chose the raw-DSP driver because it keeps the **system-under-test (the BaSyx
provider) unmodified** — it's just the lib's own `mvd`→`mock` config flip. The
alternatives all fail or are worse:

| Alternative | Why not |
|---|---|
| Keep EDC consumer; provider stays `mvd`, feed it a mock token | `mvd` *is* full DCP (signature + DID + VP); a mock token fails it → not "off". |
| Keep `mvd`, patch `MvdValidationService` to skip crypto | Benchmarks a *modified* connector; neither shipped `mvd` nor `mock`. Worse construct validity. |
| Keep EDC consumer; patch BaSyx `mock` to accept the EDC token | Edits the thing under test (the validator) to bridge token formats. |
| Keep DCP but local/embedded STS (no Identity Hub round-trip) | "Reduced identity", not off — still does signature + VP verification. A *different* experiment (isolates the network hop), smaller delta. |
| **Raw-DSP k6 driver + sink, provider `mock`** (chosen) | SUT unmodified; genuinely zero identity work. Price: consumer differs ON↔OFF → read delta within-BaSyx. |

Two facts that make the chosen approach essentially irreducible: BaSyx `mock` *is* the
"no identity" path (no crypto, injects `dataspacemember`), and the **callback sink is
unavoidable for any non-EDC consumer** — the provider pushes the agreement/FINALIZED/
EDR asynchronously and its GET status endpoint doesn't return the EDR, so a full EDC
connector is the only consumer that escapes hosting callbacks.

### The road not taken (recommended future migration — discuss before adopting)

The one alternative that would be **genuinely better for cross-connector
comparability**: run the EDC consumer in **iam-mock** mode *and* add an
**iam-mock-compatible validator** to `dsp-protocol-lib` (a third `@ConditionalOnProperty
org.factoryx.library.validationservice=iammock` service alongside `mvd`/`mock`) that
accepts the token shape an EDC iam-mock consumer emits. Then BaSyx OFF would use the
**same stock `org.eclipse.edc:iam-mock` mechanism** as the EDC and Factory-X OFF arms,
the shared harness (EDC consumer + Management API) would drive *all three* OFF arms
identically, the callback sink would no longer be needed, and the G1−G2 delta could be
read **across** connectors, not just within BaSyx.

Trade-off to weigh in that discussion:
- **Pro:** restores full harness parity + cross-connector comparability; removes the
  bespoke driver and sink.
- **Con:** it's a Java change to `dsp-protocol-lib` (a new validation service), and it's
  still a *custom* validator — not the connector's shipped behaviour — so it trades one
  construct-validity caveat (consumer asymmetry) for another (a non-upstream lib mod).
- **Migration effort:** write `IamMockValidationService` (mirror `MockValidationService`
  but parse the EDC iam-mock token), gate it on the new property value, add an
  `…-iammock` OFF compose that runs the EDC consumer in iam-mock mode + provider with
  `validationservice=iammock`, and then this whole `basyx-off/` driver + sink can be
  retired in favour of the shared harness.

Until that discussion happens, the current raw-DSP arm stands and is the verified
working path (see *Status*).

## How it works

The dsp-protocol-lib provider runs negotiation/transfer **asynchronously**: after a
consumer POSTs a request, the provider *pushes* the ContractAgreement, the FINALIZED
event, and the TransferStart (carrying the EDR data-access token) to the consumer's
`callbackAddress`. k6 cannot host an HTTP server, so a tiny **callback sink**
(`../tools/dsp-callback-sink/sink.js`, run as the `dsp-callback-sink` compose service)
captures those pushes; the driver polls the sink for them.

```
k6(host) ─ POST :8090/dsp/catalog/request (mock token) ──────────────▶ BaSyx → asset@id, offer@id
k6 ─ POST :8090/dsp/negotiations/request (callbackAddress=sink, consumerPid) ▶ BaSyx → 201 {providerPid}
BaSyx ── push ContractAgreementMessage ──▶ SINK /negotiations/{consumerPid}/agreement   (→ contractId)
k6 ─ poll sink ─ POST :8090/dsp/negotiations/{providerPid}/agreement/verification ▶ BaSyx → 200
BaSyx ── push FINALIZED ──▶ SINK /negotiations/{consumerPid}/events
k6 ─ POST :8090/dsp/transfers/request (callbackAddress=sink, agreementId) ▶ BaSyx → ACK {providerPid}
BaSyx ── push TransferStartMessage ──▶ SINK /transfers/{consumerPid}/start   (→ endpoint + data-access token)
k6 ─ poll sink ─ GET {endpoint} (Authorization: token) ─────────────▶ BaSyx data-access → DATA
```

The mock token is `Bearer {"clientId":"consumer","audience":"http://dsp-native-basyx:8090/dsp"}`
— no signature, no crypto. The provider only checks that `audience` starts with its
own DSP url. All driver settings live in `../config/basyx.json` under `off`.

## Run

```bash
# 1. boot the OFF stack (provider in mock mode + monitoring + the callback sink)
docker compose -f docker-compose-mock.monitoring.yaml up -d        # from repo root
#    wait for dsp-native-basyx + keycloak + dsp-callback-sink to be up
curl -s http://localhost:8888/health    # -> ok   (sink reachable from the host)

# 2. run the OFF smoke (the gate). The k6 setup() SELF-SEEDS the pinned shell
#    DataAsset first (basyx-off/seed.js: Keycloak token -> POST /shells, idempotent),
#    so no manual seeding is needed. A consumer-PULL needs a REGULAR shell DataAsset
#    (the *ApiAsset catalog entries are write-forward proxies, not GET-readable);
#    the seeded shell's id == off.assetIdSelector so the driver targets it. Mongo
#    also has a persistent volume now, so the data survives plain restarts too.
#    (Disable self-seed with off.seed.enabled=false if you pre-seed out-of-band.)
cd k6-scripts
k6 run -e CONNECTOR=basyx -e IDENTITY_MODE=off basyx-off/smoke.js

# 3. once smoke is green, run the load scenarios (same as the ON arm; each self-seeds)
k6 run -e CONNECTOR=basyx -e IDENTITY_MODE=off basyx-off/steady.js
k6 run -e CONNECTOR=basyx -e IDENTITY_MODE=off basyx-off/saturation-open.js
k6 run -e CONNECTOR=basyx -e IDENTITY_MODE=off basyx-off/concurrency-closed.js
k6 run -e CONNECTOR=basyx -e IDENTITY_MODE=off basyx-off/soak.js
```

A green smoke proves the full cycle completes with **only** the mock token — i.e.
identity verification is genuinely bypassed.

## Scenarios

These OFF entrypoints reuse the **exact** load profiles + thresholds + metric set of
their `../scenarios/` counterparts (only the iteration body differs: `runDspFlow`
instead of `runTransaction`), so the per-scenario ON−OFF delta is the provider-side
`mvd`→`mock` validation cost.

| OFF scenario | RQ | ON counterpart |
|---|---|---|
| `smoke.js` | gate | scenarios/smoke.js |
| `steady.js` | RQ1 latency/throughput | scenarios/steady.js |
| `saturation-open.js` | RQ2 scalability (open) | scenarios/saturation-open.js |
| `concurrency-closed.js` | RQ2 concurrency (closed) | scenarios/concurrency-closed.js |
| `soak.js` | RQ3 stability | scenarios/soak.js |

**Deliberately omitted (EDC-only, N/A for BaSyx):** `payload-sweep` — BaSyx has no
separate data plane (the AAS repo is a synchronous data plane); and `catalog-sweep` —
BaSyx has no Management API to seed N assets (data is pre-seeded in MongoDB). These
match the `seed.enabled=false` / `payload` notes in `config/basyx.json`.

## Findings from the first live run (2026-06-26 — all resolved)

The smoke went green after three protocol-correctness fixes; recording them because
they're easy to trip over again:

1. **Offer `assigner`** — the provider's `validateOffer` rebuilds the expected offer
   and compares it field-by-field (ignoring `@id` / empty perm-prohib-oblig):
   `assigner` must equal its **backend id** (`org.factoryx.library.id` = `provider`),
   `assignee` must equal the token's `clientId`, `target` must equal the asset `@id`.
   Sending the DID as assigner → 400 "Unexpected offer". Fixed via `off.assigner`.
2. **Wait for FINALIZED** — after the verification POST the provider asynchronously
   pushes the FINALIZED event; requesting the transfer before it lands → 400
   "Agreement record is not in FINALIZED state". The driver now gates on the sink's
   `finalized` capture.
3. **Pull a regular DataAsset, not an ApiAsset** — `GET /dsp/data-access/{id}` reads a
   regular shell DataAsset; the `*ApiAsset` entries are write-forward proxies
   (POST/PUT/DELETE-with-path) and 404 on a GET read. The selector now skips
   `*ApiAsset` and `off.assetIdSelector` pins the seeded shell `e38a0f92-…`.

Confirmed working: `audience` = `http://dsp-native-basyx:8090/dsp`; the pull host
rewrite `dsp-native-basyx:8090`→`localhost:8090`; `dct:format` = `HttpData-PULL`; the
sink captures all three pushes (`docker logs dsp-callback-sink`). If a step times out
waiting on a push, check `docker logs dsp-callback-sink` and the provider's
`AGREED/FINALIZED/STARTED MESSAGE` send logs.

## Status

**VERIFIED LIVE 2026-06-26** — the smoke runs green end-to-end (catalog → negotiation
→ verification → FINALIZED → transfer → EDR → data pull) against the mock provider
with ONLY the mock token (e2e ≈ 1.0s, 6/6 checks). The 4 load scenarios reuse the same
`runDspFlow()`. Requires AAS data seeded first (see step 2).
