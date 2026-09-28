// Proof of possession.
//
// Without this, a mandate is a bearer token: copy the JSON and you can spend.
// The agent must prove, per request, that it holds the private key the mandate
// names — and it must bind that proof to THIS request, so a captured assertion
// cannot be replayed against a different amount or merchant.

import { canonical, digest, sign, verify } from './openmandate.js';
import { randomUUID } from 'node:crypto';

const MAX_SKEW_MS = 120_000;   // 2 minutes each way

/** The agent signs the exact request it is making, plus a nonce and a clock. */
export function assertRequest({ mandate, request, agentPriv, now = new Date() }) {
  const body = {
    omv: '0.1',
    type: 'assertion',
    mandate_id: mandate.id,
    mandate_digest: digest(mandate),
    request_digest: digest(request),
    nonce: randomUUID(),
    at: now.toISOString(),
  };
  body.sig = {
    alg: 'Ed25519',
    kid: digest(mandate.agent.key).slice(0, 16),
    value: sign(agentPriv, canonical(body)),
  };
  return body;
}

/**
 * Merchant side. Returns { ok, reason }.
 * `seen` is a Set of nonces already accepted; replay dies here.
 */
export function verifyAssertion({ mandate, request, assertion, seen, now = new Date() }) {
  if (!assertion || !assertion.sig) return { ok: false, reason: 'assertion missing' };

  const { sig, ...body } = assertion;
  if (!verify(mandate.agent.key, canonical(body), sig.value)) {
    return { ok: false, reason: 'assertion not signed by the mandate agent key' };
  }
  if (assertion.mandate_id !== mandate.id) {
    return { ok: false, reason: 'assertion is for another mandate' };
  }
  if (assertion.mandate_digest !== digest(mandate)) {
    return { ok: false, reason: 'mandate was altered after the assertion was signed' };
  }
  if (assertion.request_digest !== digest(request)) {
    return { ok: false, reason: 'assertion does not cover this request' };
  }
  const skew = Math.abs(now.getTime() - Date.parse(assertion.at));
  if (!Number.isFinite(skew)) return { ok: false, reason: 'assertion has no usable timestamp' };
  if (skew > MAX_SKEW_MS) return { ok: false, reason: 'assertion is outside the accepted time window' };

  if (seen) {
    if (seen.has(assertion.nonce)) return { ok: false, reason: 'assertion replayed' };
    seen.add(assertion.nonce);
  }
  return { ok: true, reason: 'agent proved possession of its key for this exact request' };
}

export { MAX_SKEW_MS };
