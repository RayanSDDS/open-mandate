// Three-party handshake.
//
// Taken from the shape of ATH. A mandate binds a human and an agent and leaves
// the service as a passive verifier. That is asymmetric: a merchant can verify
// a mandate today and deny tomorrow that it ever accepted those terms, because
// it never signed anything before the money moved.
//
// Here all three commit, in order, before any transaction:
//   1. the agent PROPOSES a session against a mandate its human signed
//   2. the merchant ACCEPTS, and in doing so commits to its own terms
//   3. the agent CONFIRMS it saw those exact terms
//
// Three signatures over one object. Nobody can later claim they were shown
// something else.

import { canonical, digest, sign, verify, sigOk } from './openmandate.js';
import { randomUUID } from 'node:crypto';

const DEFAULT_TTL_MS = 15 * 60_000;
const strip = o => { const { sig, ...rest } = o; return rest; };

/** Step 1 — the agent proposes. */
export function propose({ mandate, merchantHost, agentPriv, ttlMs = DEFAULT_TTL_MS, now = new Date() }) {
  const body = {
    omv: '0.1', type: 'session.proposal',
    session_id: 'urn:uuid:' + randomUUID(),
    mandate_id: mandate.id,
    mandate_digest: digest(mandate),
    agent_key: mandate.agent.key,
    merchant: merchantHost,
    at: now.toISOString(),
    expires_at: new Date(now.getTime() + ttlMs).toISOString(),
  };
  body.sig = { alg: 'Ed25519', by: 'agent', kid: digest(mandate.agent.key).slice(0, 16),
               value: sign(agentPriv, canonical(body)) };
  return body;
}

function checkProposal({ mandate, proposal, merchantHost, now }) {
  if (!sigOk(mandate)) return 'mandate signature invalid';
  if (!proposal || !proposal.sig) return 'proposal unsigned';
  if (!verify(mandate.agent.key, canonical(strip(proposal)), proposal.sig.value)) {
    return 'proposal not signed by the mandate agent key';
  }
  if (proposal.mandate_id !== mandate.id) return 'proposal is for another mandate';
  if (proposal.mandate_digest !== digest(mandate)) return 'mandate altered after the proposal';
  if (proposal.merchant !== merchantHost) return `proposal names ${proposal.merchant}, not ${merchantHost}`;
  if (now > new Date(proposal.expires_at)) return 'proposal expired';
  return null;
}

/**
 * Step 2 — the merchant accepts and binds its own terms into the session.
 * `terms` is whatever it agrees to be held to: a returns window, the digest of
 * the price list in force, a dispute address.
 */
export function accept({ mandate, proposal, merchantHost, merchantPriv, merchantPub,
                         terms = {}, now = new Date() }) {
  const problem = checkProposal({ mandate, proposal, merchantHost, now });
  if (problem) return { ok: false, reason: problem };

  const body = {
    omv: '0.1', type: 'session.acceptance',
    session_id: proposal.session_id,
    proposal_digest: digest(proposal),
    merchant: merchantHost,
    merchant_key: merchantPub,
    terms,
    terms_digest: digest(terms),
    at: now.toISOString(),
    expires_at: proposal.expires_at,
  };
  body.sig = { alg: 'Ed25519', by: 'merchant', kid: digest(merchantPub).slice(0, 16),
               value: sign(merchantPriv, canonical(body)) };
  return { ok: true, acceptance: body };
}

/** Step 3 — the agent confirms it saw those exact terms. The session is now live. */
export function confirm({ mandate, proposal, acceptance, agentPriv, now = new Date() }) {
  if (acceptance.proposal_digest !== digest(proposal)) {
    return { ok: false, reason: 'acceptance does not answer this proposal' };
  }
  if (!verify(acceptance.merchant_key, canonical(strip(acceptance)), acceptance.sig.value)) {
    return { ok: false, reason: 'merchant acceptance is not signed by the key it names' };
  }
  const body = {
    omv: '0.1', type: 'session.confirmation',
    session_id: proposal.session_id,
    acceptance_digest: digest(acceptance),
    terms_digest: acceptance.terms_digest,
    at: now.toISOString(),
  };
  body.sig = { alg: 'Ed25519', by: 'agent', kid: digest(mandate.agent.key).slice(0, 16),
               value: sign(agentPriv, canonical(body)) };
  return { ok: true, session: { proposal, acceptance, confirmation: body } };
}

/** Anyone holding a session can check all three signatures, with no extra state. */
export function verifySession({ mandate, session, merchantHost, now = new Date() }) {
  if (!session || !session.proposal || !session.acceptance || !session.confirmation) {
    return { ok: false, reason: 'session incomplete: three signatures are required' };
  }
  const { proposal, acceptance, confirmation } = session;

  const problem = checkProposal({ mandate, proposal, merchantHost, now });
  if (problem) return { ok: false, reason: problem };

  if (acceptance.session_id !== proposal.session_id) return { ok: false, reason: 'session id mismatch' };
  if (acceptance.proposal_digest !== digest(proposal)) return { ok: false, reason: 'acceptance answers another proposal' };
  if (acceptance.merchant !== merchantHost) return { ok: false, reason: 'acceptance names another merchant' };
  if (!verify(acceptance.merchant_key, canonical(strip(acceptance)), acceptance.sig.value)) {
    return { ok: false, reason: 'merchant signature invalid' };
  }
  if (digest(acceptance.terms) !== acceptance.terms_digest) {
    return { ok: false, reason: 'merchant terms altered after acceptance' };
  }
  if (confirmation.session_id !== proposal.session_id) return { ok: false, reason: 'confirmation for another session' };
  if (confirmation.acceptance_digest !== digest(acceptance)) {
    return { ok: false, reason: 'confirmation does not cover these terms' };
  }
  if (confirmation.terms_digest !== acceptance.terms_digest) {
    return { ok: false, reason: 'confirmed terms differ from accepted terms' };
  }
  if (!verify(mandate.agent.key, canonical(strip(confirmation)), confirmation.sig.value)) {
    return { ok: false, reason: 'agent confirmation signature invalid' };
  }
  if (now > new Date(proposal.expires_at)) return { ok: false, reason: 'session expired' };

  return { ok: true, reason: 'three parties signed the same terms', terms: acceptance.terms };
}

export { DEFAULT_TTL_MS };
