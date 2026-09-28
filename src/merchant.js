// The merchant side of the protocol.
//
// This is the half nobody has published. Visa TAP, Stripe SPT and AP2 all
// describe what the buyer presents; none of them ship a merchant that decides,
// countersigns and keeps its own book. A protocol where only one side signs is
// a monologue.
//
// A merchant does NOT trust the agent's own ledger. It keeps its own record of
// what it accepted under each mandate, because the agent's copy is exactly the
// thing an attacker would edit.

import { canonical, digest, sign, units, sigOk, decide } from './openmandate.js';
import { verifyAssertion } from './assertion.js';
import { accept as acceptSession, verifySession } from './handshake.js';

const fmt = u => (Number(u) / 1e6).toFixed(2);

export function createMerchant({ host, priv, pub, terms = {}, requireSession = false,
                                 now = () => new Date() }) {
  const books = new Map();   // mandate_id -> accepted entries
  const nonces = new Set();

  /** The merchant's half of the three-party handshake. It commits to its terms. */
  function acceptProposal({ mandate, proposal }) {
    return acceptSession({ mandate, proposal, merchantHost: host,
                           merchantPriv: priv, merchantPub: pub, terms, now: now() });
  }

  function ledgerOf(id) {
    if (!books.has(id)) books.set(id, []);
    return books.get(id);
  }

  /**
   * @returns {{decision:'authorized'|'declined'|'needs_human', reason:string,
   *            order_id?:string, receipt?:object, checks?:object[]}}
   */
  function checkout({ mandate, request, assertion, session }) {
    const at = now();
    const deny = (reason, extra = {}) => ({ decision: 'declined', reason, ...extra });

    // 1. Is this document genuine, and is it for us?
    if (!sigOk(mandate)) return deny('mandate signature invalid');
    if (request.merchant !== host && !host.endsWith('.' + request.merchant)) {
      return deny(`this mandate was presented to ${host} but names ${request.merchant}`);
    }
    if (!mandate.grant.merchants.some(m => host === m || host.endsWith('.' + m))) {
      return deny(`${host} is not in the mandate merchant list`);
    }

    // 2. If a session is required, all three parties must already have signed
    //    the same terms. The merchant will not transact on terms it never saw.
    let sessionTerms = null;
    if (requireSession || session) {
      if (!session) return deny('no session: this merchant requires a three-party handshake');
      const s = verifySession({ mandate, session, merchantHost: host, now: at });
      if (!s.ok) return deny('session rejected: ' + s.reason);
      sessionTerms = s.terms;
    }

    // 3. Is the party presenting it actually the agent it names?
    const pop = verifyAssertion({ mandate, request, assertion, seen: nonces, now: at });
    if (!pop.ok) return deny(pop.reason);

    // 4. Does it pass the mandate's own rules, against OUR book, not theirs?
    const d = decide({ mandate, request, ledger: ledgerOf(mandate.id), now: at });
    if (d.decision === 'deny') return deny(d.reason, { checks: d.checks });
    if (d.decision === 'needs_human') {
      return { decision: 'needs_human', reason: d.reason, checks: d.checks };
    }

    // 5. Accept, book it, and countersign. Two signatures now exist on this
    //    transaction: the agent's assertion and the merchant's receipt.
    const seq = ledgerOf(mandate.id).length + 1;
    const order_id = `${host}-${at.getTime().toString(36)}-${seq}`;
    const receipt = {
      omv: '0.1', type: 'merchant_receipt',
      merchant: host, order_id,
      mandate_id: mandate.id,
      mandate_digest: digest(mandate),
      assertion_nonce: assertion.nonce,
      seq, at: at.toISOString(),
      action: request.action, amount: request.amount,
      session_id: session ? session.proposal.session_id : null,
      terms_digest: session ? session.acceptance.terms_digest : null,
      outcome: 'authorized',
    };
    receipt.sig = { alg: 'Ed25519', kid: digest(pub).slice(0, 16),
                    value: sign(priv, canonical(receipt)) };

    ledgerOf(mandate.id).push({
      seq, at: receipt.at, action: request.action,
      amount: request.amount, outcome: 'authorized', order_id,
    });

    return { decision: 'authorized',
             reason: session ? 'within mandate, agent proved possession, terms agreed by three parties'
                             : 'within mandate, agent proved possession',
             order_id, receipt, terms: sessionTerms, checks: d.checks };
  }

  function statement(mandateId) {
    const rows = ledgerOf(mandateId);
    const spent = rows.filter(r => r.outcome === 'authorized')
                      .reduce((s, r) => s + units(r.amount), 0n);
    return { merchant: host, mandate_id: mandateId, count: rows.length,
             spent: fmt(spent), rows };
  }

  return { host, pub, terms, acceptProposal, checkout, statement };
}
