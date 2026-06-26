// DSP callback sink for the BaSyx identity-OFF (mock) arm.
//
// WHY THIS EXISTS: the dsp-protocol-lib provider runs contract negotiation and
// transfer ASYNCHRONOUSLY. After a consumer POSTs a request, the provider pushes
// the ContractAgreement, the FINALIZED event, and the TransferStart (which carries
// the EDR data-access token) to the consumer's callbackAddress. k6 is a load
// generator and cannot host an HTTP server, so this tiny zero-dependency Node sink
// stands in as the consumer's DSP callback endpoint: it captures each push keyed by
// the consumerPid and lets k6 poll for the result.
//
// NETWORKING: the provider reaches it at http://dsp-callback-sink:8888 (compose
// network); k6 on the host polls it at http://localhost:8888 (published port).
//
// The provider's Send*Task helpers only check for a 2xx response, so an empty 200
// to every push is sufficient.

const http = require('http');

// consumerPid -> { agreement, finalized, transferStart }
const captures = new Map();

function record(pid, key, body) {
  const entry = captures.get(pid) || {};
  entry[key] = body;
  captures.set(pid, entry);
  console.log(`captured ${key} for consumerPid=${pid}`);
}

const server = http.createServer((req, res) => {
  const { method, url } = req;

  // --- k6 polling endpoints -------------------------------------------------
  let m;
  if (method === 'GET' && (m = url.match(/^\/captured\/([^/?]+)/))) {
    const pid = decodeURIComponent(m[1]);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(captures.get(pid) || {}));
    return;
  }
  if (method === 'GET' && url === '/health') {
    res.writeHead(200); res.end('ok'); return;
  }

  // --- provider async pushes ------------------------------------------------
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    let parsed;
    try { parsed = JSON.parse(body); } catch (_) { parsed = { raw: body }; }

    // Provider targets (callbackAddress + path):
    //   /negotiations/{consumerPid}/agreement   -> ContractAgreementMessage
    //   /negotiations/{consumerPid}/events       -> ContractNegotiationEventMessage (FINALIZED)
    //   /transfers/{consumerPid}/start           -> TransferStartMessage (carries the EDR)
    let mm;
    if ((mm = url.match(/\/negotiations\/([^/]+)\/agreement\/?$/))) {
      record(decodeURIComponent(mm[1]), 'agreement', parsed);
    } else if ((mm = url.match(/\/negotiations\/([^/]+)\/events\/?$/))) {
      record(decodeURIComponent(mm[1]), 'finalized', parsed);
    } else if ((mm = url.match(/\/transfers\/([^/]+)\/start\/?$/))) {
      record(decodeURIComponent(mm[1]), 'transferStart', parsed);
    } else {
      // unknown push — keep it under a catch-all key for debugging
      record('_unmatched', url, parsed);
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });
});

const PORT = process.env.SINK_PORT || 8888;
server.listen(PORT, () => console.log(`dsp-callback-sink listening on :${PORT}`));
