#!/usr/bin/env node
// open-mandate hosted service — the commercial layer.
//
// The format and the verifier are Apache-2.0 and always free: anyone can issue
// and verify a mandate offline, forever, with no account.
//
// What cannot be done offline is what this service sells:
//   1. REVOCATION   - a mandate must be cancellable *after* it was handed out.
//                     Offline verification cannot know that. Someone has to
//                     answer the phone, always, from an address the merchant
//                     already trusts.
//   2. NOTARIZATION - a receipt signed only by the agent proves the agent said
//                     it. A countersignature with an independent clock proves
//                     *when*, to a party with no stake in the outcome.
//   3. ARCHIVAL     - a ledger held only by the agent can be lost. A dispute
//                     six months later needs the chain to still exist.
//
// Run: node service/server.js --port 8787 --key service.key
// Storage here is a JSON file: deliberately trivial, swap it for a database.

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { canonical, digest, sign, keygen, sigOk, audit } from '../src/openmandate.js';

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i === -1 ? d : process.argv[i + 1]; };
const PORT = Number(arg('port', 8787));
const STORE = arg('store', 'service-store.json');
const KEYFILE = arg('key', 'service.key');

if (!existsSync(KEYFILE)) {
  const k = keygen();
  writeFileSync(KEYFILE, k.priv + '\n', { mode: 0o600 });
  writeFileSync(KEYFILE.replace(/\.key$/, '.pub'), k.pub + '\n');
  console.log(`generated service key -> ${KEYFILE}`);
}
const SERVICE_PRIV = readFileSync(KEYFILE, 'utf8').trim();

const load = () => existsSync(STORE) ? JSON.parse(readFileSync(STORE, 'utf8')) : { revoked: {}, ledgers: {} };
const save = db => writeFileSync(STORE, JSON.stringify(db, null, 2));
let db = load();

const json = (res, code, body) => {
  const s = JSON.stringify(body, null, 2);
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(s) });
  res.end(s);
};
const readBody = req => new Promise((ok, no) => {
  let b = ''; req.on('data', c => { b += c; if (b.length > 1e6) req.destroy(); });
  req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { no(e); } });
});

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const parts = url.pathname.split('/').filter(Boolean);

  try {
    // GET /v1/mandates/:id/status  -- the URL a mandate carries in revocation.url
    if (req.method === 'GET' && parts[0] === 'v1' && parts[1] === 'mandates' && parts[3] === 'status') {
      const id = decodeURIComponent(parts[2]);
      const rec = db.revoked[id];
      return json(res, 200, {
        mandate_id: id,
        revoked: !!rec,
        revoked_at: rec ? rec.at : null,
        reason: rec ? rec.reason : null,
        checked_at: new Date().toISOString(),
      });
    }

    // POST /v1/mandates/:id/revoke  { reason }
    if (req.method === 'POST' && parts[0] === 'v1' && parts[1] === 'mandates' && parts[3] === 'revoke') {
      const id = decodeURIComponent(parts[2]);
      const body = await readBody(req);
      db.revoked[id] = { at: new Date().toISOString(), reason: body.reason || 'unspecified' };
      save(db);
      return json(res, 200, { mandate_id: id, revoked: true, ...db.revoked[id] });
    }

    // POST /v1/receipts  { mandate, receipt }  -> independent countersignature
    if (req.method === 'POST' && parts[0] === 'v1' && parts[1] === 'receipts') {
      const { mandate, receipt } = await readBody(req);
      if (!mandate || !receipt) return json(res, 400, { error: 'mandate and receipt required' });
      if (!sigOk(mandate)) return json(res, 400, { error: 'mandate signature invalid' });

      const observed_at = new Date().toISOString();
      const attestation = {
        omv: '0.1', type: 'notarization',
        mandate_id: mandate.id, receipt_seq: receipt.seq,
        receipt_digest: digest(receipt), observed_at,
      };
      attestation.sig = { alg: 'Ed25519', value: sign(SERVICE_PRIV, canonical(attestation)) };

      (db.ledgers[mandate.id] ||= []).push({ receipt, attestation });
      save(db);
      return json(res, 201, attestation);
    }

    // GET /v1/mandates/:id/ledger  -- archival copy, verifiable by anyone
    if (req.method === 'GET' && parts[0] === 'v1' && parts[1] === 'mandates' && parts[3] === 'ledger') {
      const id = decodeURIComponent(parts[2]);
      const entries = db.ledgers[id] || [];
      return json(res, 200, { mandate_id: id, count: entries.length, entries });
    }

    // GET /v1/verify-chain?mandate_id=...   (needs the mandate posted once)
    if (req.method === 'POST' && parts[0] === 'v1' && parts[1] === 'verify-chain') {
      const { mandate } = await readBody(req);
      if (!mandate) return json(res, 400, { error: 'mandate required' });
      const entries = db.ledgers[mandate.id] || [];
      return json(res, 200, audit(mandate, entries.map(e => e.receipt)));
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      return json(res, 200, { ok: true, service: 'open-mandate', version: '0.1.0' });
    }

    json(res, 404, { error: 'not found', see: '/health' });
  } catch (e) {
    json(res, 500, { error: e.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`open-mandate service on http://127.0.0.1:${PORT}`);
  console.log(`  GET  /v1/mandates/:id/status`);
  console.log(`  POST /v1/mandates/:id/revoke`);
  console.log(`  POST /v1/receipts`);
  console.log(`  GET  /v1/mandates/:id/ledger`);
  console.log(`  POST /v1/verify-chain`);
});
