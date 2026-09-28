import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keygen, issue, clone } from '../src/openmandate.js';
import { propose, accept, confirm, verifySession } from '../src/handshake.js';
import { assertRequest } from '../src/assertion.js';
import { createMerchant } from '../src/merchant.js';

const EUR = a => ({ amount: a, currency: 'EUR' });
const TERMS = { returns_window_days: 30, price_list: 'pl-2026-09', disputes: 'disputes@hardware.example' };

function world(opts = {}) {
  const P = keygen(), A = keygen(), M = keygen();
  const m = issue({
    principalPriv: P.priv, principalPub: P.pub, agentPub: A.pub,
    agentId: 'urn:agent:claude-desktop', operator: 'Anthropic',
    actions: ['payment.authorize'], merchants: ['hardware.example'],
    perTx: EUR('500.00'), total: EUR('1000.00'), maxUses: 5,
    humanAbove: EUR('200.00'), purpose: 'test',
  });
  const merchant = createMerchant({ host: 'hardware.example', priv: M.priv, pub: M.pub,
                                    terms: TERMS, requireSession: opts.requireSession });
  return { P, A, M, m, merchant };
}

function shake(w) {
  const proposal = propose({ mandate: w.m, merchantHost: 'hardware.example', agentPriv: w.A.priv });
  const a = w.merchant.acceptProposal({ mandate: w.m, proposal });
  assert.equal(a.ok, true, a.reason);
  const c = confirm({ mandate: w.m, proposal, acceptance: a.acceptance, agentPriv: w.A.priv });
  assert.equal(c.ok, true, c.reason);
  return c.session;
}

test('three parties sign the same terms', () => {
  const w = world();
  const s = shake(w);
  const v = verifySession({ mandate: w.m, session: s, merchantHost: 'hardware.example' });
  assert.equal(v.ok, true, v.reason);
  assert.equal(v.terms.returns_window_days, 30);
});

test('the merchant is bound to the terms it signed', () => {
  const w = world();
  const s = shake(w);
  const tampered = clone(s);
  tampered.acceptance.terms.returns_window_days = 0;
  const v = verifySession({ mandate: w.m, session: tampered, merchantHost: 'hardware.example' });
  assert.equal(v.ok, false);
  assert.match(v.reason, /merchant signature invalid|terms altered/);
});

test('the agent cannot silently swap the terms it confirmed', () => {
  const w = world();
  const s = shake(w);
  const swapped = clone(s);
  swapped.confirmation.terms_digest = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const v = verifySession({ mandate: w.m, session: swapped, merchantHost: 'hardware.example' });
  assert.equal(v.ok, false);
});

test('a session is refused by a merchant it does not name', () => {
  const w = world();
  const s = shake(w);
  const v = verifySession({ mandate: w.m, session: s, merchantHost: 'elsewhere.example' });
  assert.equal(v.ok, false);
});

test('an incomplete session is not a session', () => {
  const w = world();
  const s = shake(w);
  for (const missing of ['proposal', 'acceptance', 'confirmation']) {
    const partial = clone(s); delete partial[missing];
    const v = verifySession({ mandate: w.m, session: partial, merchantHost: 'hardware.example' });
    assert.equal(v.ok, false);
    assert.match(v.reason, /incomplete/);
  }
});

test('a merchant refuses a proposal signed by someone else', () => {
  const w = world();
  const thief = keygen();
  const bad = propose({ mandate: w.m, merchantHost: 'hardware.example', agentPriv: thief.priv });
  const a = w.merchant.acceptProposal({ mandate: w.m, proposal: bad });
  assert.equal(a.ok, false);
  assert.match(a.reason, /not signed by the mandate agent key/);
});

test('a session expires', () => {
  const w = world();
  const proposal = propose({ mandate: w.m, merchantHost: 'hardware.example',
                             agentPriv: w.A.priv, ttlMs: 1000 });
  const a = w.merchant.acceptProposal({ mandate: w.m, proposal });
  const c = confirm({ mandate: w.m, proposal, acceptance: a.acceptance, agentPriv: w.A.priv });
  const later = new Date(Date.now() + 60_000);
  const v = verifySession({ mandate: w.m, session: c.session, merchantHost: 'hardware.example', now: later });
  assert.equal(v.ok, false);
  assert.match(v.reason, /expired/);
});

test('a merchant that requires a session refuses a bare purchase', () => {
  const w = world({ requireSession: true });
  const request = { action: 'payment.authorize', merchant: 'hardware.example', amount: EUR('50.00') };
  const r = w.merchant.checkout({
    mandate: w.m, request,
    assertion: assertRequest({ mandate: w.m, request, agentPriv: w.A.priv }),
  });
  assert.equal(r.decision, 'declined');
  assert.match(r.reason, /three-party handshake/);
});

test('with a valid session the purchase goes through and records the terms', () => {
  const w = world({ requireSession: true });
  const session = shake(w);
  const request = { action: 'payment.authorize', merchant: 'hardware.example', amount: EUR('50.00') };
  const r = w.merchant.checkout({
    mandate: w.m, request, session,
    assertion: assertRequest({ mandate: w.m, request, agentPriv: w.A.priv }),
  });
  assert.equal(r.decision, 'authorized');
  assert.equal(r.receipt.session_id, session.proposal.session_id);
  assert.equal(r.receipt.terms_digest, session.acceptance.terms_digest);
  assert.equal(r.terms.returns_window_days, 30);
});

test('a session from another mandate cannot be reused', () => {
  const w = world({ requireSession: true });
  const other = world();
  const request = { action: 'payment.authorize', merchant: 'hardware.example', amount: EUR('50.00') };
  const r = w.merchant.checkout({
    mandate: w.m, request, session: shake(other),
    assertion: assertRequest({ mandate: w.m, request, agentPriv: w.A.priv }),
  });
  assert.equal(r.decision, 'declined');
  assert.match(r.reason, /session rejected/);
});

test('a session does not survive tampering with the mandate', () => {
  const w = world({ requireSession: true });
  const session = shake(w);
  const raised = clone(w.m);
  raised.limits.per_transaction.amount = '9999.00';
  const request = { action: 'payment.authorize', merchant: 'hardware.example', amount: EUR('50.00') };
  const r = w.merchant.checkout({
    mandate: raised, request, session,
    assertion: assertRequest({ mandate: raised, request, agentPriv: w.A.priv }),
  });
  assert.equal(r.decision, 'declined');
});
