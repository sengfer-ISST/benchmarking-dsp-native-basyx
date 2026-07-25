// Raw-DSP consumer driver for the BaSyx identity-OFF (mock) arm.
//
// The shared harness (../lib/flow.js) drives the EDC consumer Management API. In
// the OFF arm there is NO EDC consumer: the provider's MockValidationService
// expects a plain-JSON {clientId,audience} bearer token, which the EDC DCP consumer
// cannot emit. So this driver speaks the DSP protocol (v0.8) DIRECTLY to the BaSyx
// provider with a JSON mock token, and reads the provider's async pushes from the
// dsp-callback-sink.
//
// FLOW: catalog -> negotiation request -> [sink: agreement] -> verification ->
//       [sink: FINALIZED] -> transfer request -> [sink: TransferStart w/ EDR] ->
//       data pull.  Every active call carries the mock bearer token.
//
// METRICS: records into the SAME ../lib/metrics.js trends/counters as the shared
// runTransaction() (catalog_duration, negotiation_init_duration, time_to_agreed,
// transfer_init_duration, time_to_edr, datapull_duration, data_throughput_MBps,
// e2e_transaction_duration, dsp_transactions_*), tagged identity_mode=off, so the
// OFF series are directly comparable to the ON series per scenario.
//
// PARITY NOTE: this driver is intentionally NOT byte-identical to the shared
// harness — it cannot be, because BaSyx-mock is wire-incompatible with the EDC
// consumer. It lives under basyx-off/ and is excluded from verify-parity. The
// BaSyx G1-G2 delta is read WITHIN BaSyx (provider-side mvd->mock cost), per the
// methodology's construct-validity note.

import http from 'k6/http';
import { group, sleep } from 'k6';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';
import { CONFIG, commonTags } from '../lib/config.js';
import { m } from '../lib/metrics.js';

const OFF = CONFIG.off;

const DSPACE = 'https://w3id.org/dspace/v0.8/';
const ODRL = 'http://www.w3.org/ns/odrl/2/';

// v0.8 JSON-LD context the provider expands contract/verification messages with
// (mirrors JsonUtils.LEGACY_CONTEXT in dsp-protocol-lib).
const LEGACY_CONTEXT = {
  '@vocab': 'https://w3id.org/edc/v0.0.1/ns/',
  edc: 'https://w3id.org/edc/v0.0.1/ns/',
  odrl: ODRL,
  dspace: DSPACE,
  dct: 'https://purl.org/dc/terms/',
};

const tag = (phase) => Object.assign({}, commonTags, { phase });

// --- helpers ---------------------------------------------------------------

// Mock token: MockValidationService parses this raw JSON and checks that
// `audience` starts with the provider's own DSP url. No signature, no crypto.
function mockToken() {
  return 'Bearer ' + JSON.stringify({ clientId: OFF.clientId, audience: OFF.audience });
}
function dspHeaders() {
  return { headers: { 'Content-Type': 'application/json', Authorization: mockToken() } };
}

// First defined value among prefixed / unprefixed key variants (the provider emits
// dspace:-prefixed keys on v0.8, but be tolerant).
function pick(obj, ...keys) {
  if (!obj) return undefined;
  for (const k of keys) if (obj[k] !== undefined) return obj[k];
  return undefined;
}
function asArray(v) {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

// Poll the sink until `key` is captured for this consumerPid, or timeout. Records
// the async wall-time into `trend` and the poll load into `counter` (mirrors the
// shared poll.js so time_to_agreed / time_to_edr are measured the same way).
function awaitCapture(consumerPid, key, trend, counter, tags) {
  const url = `${OFF.sinkPollBase}/captured/${encodeURIComponent(consumerPid)}`;
  const intervalMs = OFF.pollIntervalMs || 250;
  const t0 = Date.now();
  const deadline = t0 + (OFF.pollTimeoutMs || 30000);
  while (Date.now() < deadline) {
    if (counter) counter.add(1, tags);
    const r = http.get(url);
    if (r.status === 200) {
      const body = r.json();
      if (body && body[key]) {
        if (trend) trend.add(Date.now() - t0, tags);
        return body[key];
      }
    }
    sleep(intervalMs / 1000);
  }
  return null;
}

// --- DSP steps -------------------------------------------------------------

// 1) Catalog: returns { ok, assetId, offerId } for the selected dataset.
export function requestCatalog() {
  const body = { '@context': LEGACY_CONTEXT, '@type': 'dspace:CatalogRequestMessage' };
  const r = http.post(`${OFF.providerDspBase}/catalog/request`, JSON.stringify(body), dspHeaders());
  m.catalog.add(r.timings.duration, tag('catalog'));
  if (r.status !== 200) return { ok: false, status: r.status, body: r.body };

  const cat = r.json();
  let datasets = asArray(pick(cat, 'dcat:dataset', 'dataset'));
  if (datasets.length === 0) return { ok: false, reason: 'empty catalog', status: r.status };

  // Pick the target dataset: prefer the configured selector; else the first
  // NON-ApiAsset dataset (the *ApiAsset entries are write-forward proxies — their
  // data-access is POST/PUT/DELETE-with-path, NOT a GET read, so a consumer-PULL
  // must target a regular shell DataAsset); else the first dataset.
  const sel = OFF.assetIdSelector;
  let ds =
    (sel && datasets.find((d) => String(d['@id'] || '').indexOf(sel) >= 0)) ||
    datasets.find((d) => String(d['@id'] || '').indexOf('ApiAsset') < 0) ||
    datasets[0];
  const assetId = ds['@id'];
  const policy = asArray(pick(ds, 'odrl:hasPolicy', 'hasPolicy'))[0];
  const offerId = policy ? policy['@id'] : undefined;
  return { ok: !!(assetId && offerId), status: r.status, assetId, offerId };
}

// 2) Contract request -> 201 ACK { providerPid }. consumerPid is ours.
export function negotiate(consumerPid, assetId, offerId) {
  const body = {
    '@context': LEGACY_CONTEXT,
    '@type': 'dspace:ContractRequestMessage',
    'dspace:consumerPid': consumerPid,
    'dspace:callbackAddress': OFF.callbackAddress,
    // The provider's validateOffer rebuilds the expected offer and compares it
    // field-by-field (ignoring @id and empty permission/prohibition/obligation):
    //   assigner == its backend id (org.factoryx.library.id, e.g. "provider")
    //   assignee == the token's clientId (== partnerId)
    //   target   == the asset @id
    // so these must match exactly or it returns "Unexpected offer".
    'dspace:offer': {
      '@type': 'odrl:Offer',
      '@id': offerId,
      'odrl:target': { '@id': assetId },
      'odrl:assigner': OFF.assigner,
      'odrl:assignee': OFF.clientId,
    },
  };
  const r = http.post(`${OFF.providerDspBase}/negotiations/request`, JSON.stringify(body), dspHeaders());
  m.negotiationInit.add(r.timings.duration, tag('negotiation'));
  if (r.status !== 201 && r.status !== 200) return { ok: false, status: r.status, body: r.body };
  const ack = r.json();
  return { ok: true, status: r.status, providerPid: pick(ack, 'dspace:providerPid', 'providerPid') };
}

// 3) Verification -> 200. Waits (time_to_agreed) for the pushed agreement, reads
//    the contractId from it, then POSTs the verification.
export function verify(consumerPid, providerPid) {
  const agreementMsg = awaitCapture(consumerPid, 'agreement', m.timeToAgreed, m.negotiationPolls, tag('negotiation'));
  if (!agreementMsg) return { ok: false, reason: 'no agreement pushed to sink' };
  const agreement = pick(agreementMsg, 'dspace:agreement', 'agreement');
  const contractId = agreement ? agreement['@id'] : undefined;

  const body = {
    '@context': LEGACY_CONTEXT,
    '@type': 'dspace:ContractAgreementVerificationMessage',
    'dspace:consumerPid': consumerPid,
    'dspace:providerPid': providerPid,
  };
  const r = http.post(
    `${OFF.providerDspBase}/negotiations/${providerPid}/agreement/verification`,
    JSON.stringify(body),
    dspHeaders(),
  );
  return { ok: r.status === 200, status: r.status, contractId };
}

// 3b) Wait for the provider's async FINALIZED event before requesting transfer.
//     The provider moves the negotiation REQUESTED->AGREED->VERIFIED->FINALIZED and
//     pushes FINALIZED to {callbackAddress}/negotiations/{consumerPid}/events; the
//     transfer is rejected ("Agreement record is not in FINALIZED state") until it
//     lands. Folded into the negotiation phase (no separate metric — in the ON arm
//     the EDC consumer hides this handshake inside time_to_agreed).
export function awaitFinalized(consumerPid) {
  const fin = awaitCapture(consumerPid, 'finalized', null, null, tag('negotiation'));
  return { ok: !!fin };
}

// 4) Transfer request -> ACK. Uses a fresh consumerPid for the transfer process.
export function transfer(transferConsumerPid, contractId) {
  const body = {
    '@context': LEGACY_CONTEXT,
    '@type': 'dspace:TransferRequestMessage',
    'dspace:consumerPid': transferConsumerPid,
    'dspace:agreementId': contractId,
    'dspace:callbackAddress': OFF.callbackAddress,
    'dct:format': OFF.transferFormat,
  };
  const r = http.post(`${OFF.providerDspBase}/transfers/request`, JSON.stringify(body), dspHeaders());
  m.transferInit.add(r.timings.duration, tag('transfer'));
  if (r.status !== 201 && r.status !== 200) return { ok: false, status: r.status, body: r.body };
  const ack = r.json();
  return { ok: true, status: r.status, providerPid: pick(ack, 'dspace:providerPid', 'providerPid') };
}

// 5) Read the EDR (endpoint + data-access token) from the pushed TransferStart.
//    Waits (time_to_edr) for the push.
export function awaitEdr(transferConsumerPid) {
  const startMsg = awaitCapture(transferConsumerPid, 'transferStart', m.timeToEdr, m.edrPolls, tag('transfer'));
  if (!startMsg) return { ok: false, reason: 'no transferStart pushed to sink' };
  const dataAddress = pick(startMsg, 'dspace:dataAddress', 'dataAddress');
  if (!dataAddress) return { ok: false, reason: 'transferStart has no dataAddress' };

  let endpoint = pick(dataAddress, 'dspace:endpoint', 'endpoint');
  const props = asArray(pick(dataAddress, 'dspace:endpointProperties', 'endpointProperties'));
  let token;
  for (const p of props) {
    const name = pick(p, 'dspace:name', 'name') || '';
    if (name === 'authorization' || name.indexOf('authorization') >= 0) {
      token = pick(p, 'dspace:value', 'value');
      break;
    }
  }
  // k6 runs on the host; the endpoint the provider returns uses the container
  // hostname. Rewrite it to the host-published address (no-op if not configured).
  if (endpoint && OFF.pullRewriteFrom) {
    endpoint = endpoint.replace(OFF.pullRewriteFrom, OFF.pullRewriteTo);
  }
  return { ok: !!(endpoint && token), endpoint, token };
}

// 6) Pull the data from the provider's data-access endpoint with the EDR token.
export function pullData(endpoint, token) {
  const auth = String(token).indexOf('Bearer ') === 0 ? token : 'Bearer ' + token;
  const r = http.get(endpoint, { headers: { Authorization: auth } });
  m.datapull.add(r.timings.duration, tag('datapull'));
  const bytes = r.body ? r.body.length : 0;
  if (r.status === 200 && r.timings.duration > 0 && bytes > 0) {
    m.throughput.add((bytes / 1e6) / (r.timings.duration / 1000), tag('datapull')); // MB/s
  }
  return { ok: r.status === 200, status: r.status, bytes };
}

// Full catalog -> negotiation -> verification -> transfer -> pull cycle = one VU
// iteration. Records e2e + succeeded/failed/failedRate (tagged failed_phase) like
// the shared runTransaction, and returns a per-step result map for smoke checks.
export function runDspFlow() {
  const out = {};
  let okAll = false;
  let failedPhase = 'none';
  const t0 = Date.now();

  group('dsp_transaction', () => {
    out.catalog = requestCatalog();
    if (!out.catalog.ok) { failedPhase = 'catalog'; return; }

    const negoPid = uuidv4();
    out.negotiate = negotiate(negoPid, out.catalog.assetId, out.catalog.offerId);
    if (!out.negotiate.ok) { failedPhase = 'negotiation_init'; return; }

    out.verify = verify(negoPid, out.negotiate.providerPid);
    if (!out.verify.ok || !out.verify.contractId) { failedPhase = 'negotiation'; return; }

    out.finalized = awaitFinalized(negoPid);
    if (!out.finalized.ok) { failedPhase = 'negotiation_finalize'; return; }

    const transferPid = uuidv4();
    out.transfer = transfer(transferPid, out.verify.contractId);
    if (!out.transfer.ok) { failedPhase = 'transfer_init'; return; }

    out.edr = awaitEdr(transferPid);
    if (!out.edr.ok) { failedPhase = 'transfer'; return; }

    out.pull = pullData(out.edr.endpoint, out.edr.token);
    if (!out.pull.ok) { failedPhase = 'datapull'; return; }
    okAll = true;
  });

  if (okAll) {
    m.e2e.add(Date.now() - t0, commonTags);
    m.succeeded.add(1, commonTags);
    m.failedRate.add(false, commonTags);
  } else {
    const ft = Object.assign({}, commonTags, { failed_phase: failedPhase });
    m.failed.add(1, ft);
    m.failedRate.add(true, ft);
  }
  out.ok = okAll;
  out.failedPhase = failedPhase;
  return out;
}
