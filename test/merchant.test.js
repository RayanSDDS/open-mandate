import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keygen, issue, clone } from '../src/openmandate.js';
import { assertRequest, verifyAssertion } from '../src/assertion.js';
import { createMerchant } from '../src/merchant.js';

const EUR = a => ({ amount: a, currency: 'EUR' });

function world(over = {}) {
  const P = keygen(), A = keygen(), M = keygen();
  const m = issue({
    principalPriv: P.priv, principalPub: P.pub, agentPub: A.pub,
    agentId: 'urn:agent:claude-desktop', operator: 'Anthropic',
    actions: ['payment.authorize'],
    merchants: ['hardware.example'],
    perTx: EUR('500.00'), total: EUR('1000.00'), maxUses: 5,
    humanAbove: over.humanAbove || EUR('200.00'), purpose: 'test',
  });
  const merchant = createMerchant({ host: 'hardware.example', priv: M.priv, pub: M.pub });
  return { P, A, M, m, merchant };
}
const buy = (amount) => ({ action: 'payment.authorize', merchant: 'hardware.example', amount: EUR(amount) });
const present = (w, request) => w.merchant.checkout({
  mandate: w.m, request, assertion: assertRequest({ mandate: w.m, request, agentPriv: w.A.priv }),
});

test('a valid purchase is authorized and countersigned by the merchant', () => {
  const w = world();
  const r = present(w, buy('149.90'));
  assert.equal(r.decision, 'authorized');
  assert.match(r.order_id, /^hardware.example-/);
  assert.equal(r.receipt.type, 'merchant_receipt');
  assert.equal(r.receipt.amount.amount, '149.90');
  assert.ok(r.receipt.sig.value.length > 40);
});

test('a stolen mandate alone is useless without the agent key', () => {
  const w = world();
  const thief = keygen();
  const request = buy('10.00');
  const forged = assertRequest({ mandate: w.m, request, agentPriv: thief.priv });
  const r = w.merchant.checkout({ mandate: w.m, request, assertion: forged });
  assert.equal(r.decision, 'declined');
  assert.match(r.reason, /not signed by the mandate agent key/);
});

test('presenting no proof of possession is refused', () => {
  const w = world();
  const r = w.merchant.checkout({ mandate: w.m, request: buy('10.00'), assertion: null });
  assert.equal(r.decision, 'declined');
  assert.match(r.reason, /assertion missing/);
});

test('an assertion cannot be replayed', () => {
  const w = world();
  const request = buy('10.00');
  const a = assertRequest({ mandate: w.m, request, agentPriv: w.A.priv });
  assert.equal(w.merchant.checkout({ mandate: w.m, request, assertion: a }).decision, 'authorized');
  const again = w.merchant.checkout({ mandate: w.m, request, assertion: a });
  assert.equal(again.decision, 'declined');
  assert.match(again.reason, /replayed/);
});

test('an assertion cannot be moved onto a bigger amount', () => {
  const w = world();
  const cheap = buy('10.00');
  const a = assertRequest({ mandate: w.m, request: cheap, agentPriv: w.A.priv });
  const r = w.merchant.checkout({ mandate: w.m, request: buy('490.00'), assertion: a });
  assert.equal(r.decision, 'declined');
  assert.match(r.reason, /does not cover this request/);
});

test('an assertion does not survive tampering with the mandate', () => {
  const w = world();
  const request = buy('10.00');
  const a = assertRequest({ mandate: w.m, request, agentPriv: w.A.priv });
  const raised = clone(w.m);
  raised.limits.per_transaction.amount = '9999.00';
  const r = w.merchant.checkout({ mandate: raised, request, assertion: a });
  assert.equal(r.decision, 'declined');
  assert.match(r.reason, /signature invalid/);
});

test('a stale assertion is refused', () => {
  const w = world();
  const request = buy('10.00');
  const old = assertRequest({ mandate: w.m, request, agentPriv: w.A.priv,
                              now: new Date(Date.now() - 10 * 60_000) });
  const r = verifyAssertion({ mandate: w.m, request, assertion: old, seen: new Set() });
  assert.equal(r.ok, false);
  assert.match(r.reason, /time window/);
});

test('a merchant refuses a mandate that does not name it', () => {
  const w = world();
  const other = createMerchant({ host: 'tools.example', priv: keygen().priv, pub: keygen().pub });
  const request = buy('10.00');
  const r = other.checkout({
    mandate: w.m, request,
    assertion: assertRequest({ mandate: w.m, request, agentPriv: w.A.priv }),
  });
  assert.equal(r.decision, 'declined');
});

test('the human threshold reaches the merchant, not just the agent', () => {
  const w = world();
  const r = present(w, buy('350.00'));
  assert.equal(r.decision, 'needs_human');
});

test('the merchant enforces the cumulative cap from its OWN book', () => {
  // threshold lifted so the amounts auto-authorize; the cap is what is under test
  const w = world({ humanAbove: EUR('500.00') });
  assert.equal(present(w, buy('400.00')).decision, 'authorized');
  assert.equal(present(w, buy('400.00')).decision, 'authorized');
  // 800 of 1000 spent on the merchant's own records; the agent cannot hide it
  const over = present(w, buy('300.00'));
  assert.equal(over.decision, 'declined');
  assert.match(over.reason, /cumulative cap/);
});

test('the merchant statement matches what it accepted', () => {
  const w = world();
  present(w, buy('100.00'));
  present(w, buy('50.50'));
  const s = w.merchant.statement(w.m.id);
  assert.equal(s.count, 2);
  assert.equal(s.spent, '150.50');
  assert.equal(s.merchant, 'hardware.example');
});
