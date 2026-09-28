import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canonical, keygen, issue, sigOk, decide, receipt, audit, units, clone,
} from '../src/openmandate.js';

const EUR = a => ({ amount: a, currency: 'EUR' });

function setup(over = {}) {
  const P = keygen(), A = keygen();
  const m = issue({
    principalPriv: P.priv, principalPub: P.pub, agentPub: A.pub,
    agentId: 'urn:agent:test', operator: 'test',
    actions: ['payment.authorize'],
    merchants: ['leroymerlin.fr'],
    perTx: EUR('500.00'), total: EUR('1000.00'), maxUses: 3,
    humanAbove: EUR('200.00'), purpose: 'test', ...over,
  });
  return { P, A, m };
}

test('canonical JSON is key-order independent and recursive', () => {
  const a = { b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } };
  const b = { a: { c: [3, { e: 5, f: 4 }], d: 2 }, b: 1 };
  assert.equal(canonical(a), canonical(b));
});

test('canonical JSON preserves array order', () => {
  assert.notEqual(canonical({ x: [1, 2] }), canonical({ x: [2, 1] }));
});

test('amounts parse as integers, malformed input rejected', () => {
  assert.equal(units(EUR('0.10')) + units(EUR('0.20')), units(EUR('0.30')));
  assert.throws(() => units({ amount: 12.5, currency: 'EUR' }));
  assert.throws(() => units({ amount: '-1.00', currency: 'EUR' }));
});

test('signature verifies and stays valid on repeated calls', () => {
  const { m } = setup();
  assert.equal(sigOk(m), true);
  assert.equal(sigOk(m), true);
  assert.equal(sigOk(m), true);
});

test('verification does not mutate the mandate', () => {
  const { m } = setup();
  const before = JSON.stringify(m);
  sigOk(m);
  assert.equal(JSON.stringify(m), before);
});

test('signature survives parse and re-serialize round trip', () => {
  const { m } = setup();
  assert.equal(sigOk(JSON.parse(canonical(m))), true);
  assert.equal(sigOk(JSON.parse(JSON.stringify(m))), true);
});

test('any tampered field breaks the signature', () => {
  const { m } = setup();
  const mutations = [
    x => { x.limits.per_transaction.amount = '9999.00'; },
    x => { x.grant.merchants.push('attacker.example'); },
    x => { x.approval.human_above.amount = '99999.00'; },
    x => { x.expires_at = '2099-01-01T00:00:00.000Z'; },
    x => { x.agent.id = 'urn:agent:other'; },
  ];
  for (const mutate of mutations) {
    const t = clone(m);
    mutate(t);
    assert.equal(sigOk(t), false);
  }
});

test('decide allows a request inside every limit', () => {
  const { m } = setup();
  const d = decide({ mandate: m, request: { action: 'payment.authorize', merchant: 'leroymerlin.fr', amount: EUR('100.00') } });
  assert.equal(d.decision, 'allow');
});

test('human approval threshold is enforced, not decorative', () => {
  const { m } = setup();
  const d = decide({ mandate: m, request: { action: 'payment.authorize', merchant: 'leroymerlin.fr', amount: EUR('200.01') } });
  assert.equal(d.decision, 'needs_human');
});

test('cap, merchant, action and currency are each enforced', () => {
  const { m } = setup();
  const cases = [
    [{ action: 'payment.authorize', merchant: 'leroymerlin.fr', amount: EUR('500.01') }, 'per-transaction cap'],
    [{ action: 'payment.authorize', merchant: 'amazon.fr', amount: EUR('10.00') }, 'merchant allowed'],
    [{ action: 'payment.refund', merchant: 'leroymerlin.fr', amount: EUR('10.00') }, 'action granted'],
    [{ action: 'payment.authorize', merchant: 'leroymerlin.fr', amount: { amount: '10.00', currency: 'USD' } }, 'currency'],
  ];
  for (const pair of cases) {
    const d = decide({ mandate: m, request: pair[0] });
    assert.equal(d.decision, 'deny');
    assert.ok(d.reason.includes(pair[1]), pair[1] + ' expected, got ' + d.reason);
  }
});

test('subdomains of an allowed merchant are accepted', () => {
  const { m } = setup();
  const d = decide({ mandate: m, request: { action: 'payment.authorize', merchant: 'shop.leroymerlin.fr', amount: EUR('10.00') } });
  assert.equal(d.decision, 'allow');
});

test('expiry and revocation deny', () => {
  const { m } = setup();
  const request = { action: 'payment.authorize', merchant: 'leroymerlin.fr', amount: EUR('10.00') };
  assert.equal(decide({ mandate: m, request, now: new Date(Date.parse(m.expires_at) + 1) }).decision, 'deny');
  assert.equal(decide({ mandate: m, request, revoked: true }).decision, 'deny');
});

test('cumulative cap counts authorized receipts only', () => {
  const { A, m } = setup();
  const ledger = [];
  const req = { action: 'payment.authorize', merchant: 'leroymerlin.fr', amount: EUR('400.00') };
  for (let i = 0; i < 2; i++) {
    ledger.push(receipt({ mandate: m, ledger, ...req, outcome: 'authorized' }, A.priv));
  }
  assert.equal(decide({ mandate: m, request: req, ledger }).decision, 'deny');
  assert.equal(decide({ mandate: m, request: { ...req, amount: EUR('150.00') }, ledger }).decision, 'allow');
});

test('declined receipts do not consume the cumulative cap', () => {
  const { A, m } = setup();
  const req = { action: 'payment.authorize', merchant: 'leroymerlin.fr', amount: EUR('400.00') };
  const ledger = [receipt({ mandate: m, ledger: [], ...req, outcome: 'declined' }, A.priv)];
  const d = decide({ mandate: m, request: { ...req, amount: EUR('500.00') }, ledger });
  const check = d.checks.find(c => c.name === 'cumulative cap');
  assert.ok(check.ok);
});

test('use count is enforced', () => {
  const { A, m } = setup();
  const ledger = [];
  const req = { action: 'payment.authorize', merchant: 'leroymerlin.fr', amount: EUR('1.00') };
  for (let i = 0; i < 3; i++) {
    ledger.push(receipt({ mandate: m, ledger, ...req, outcome: 'authorized' }, A.priv));
  }
  assert.equal(decide({ mandate: m, request: req, ledger }).decision, 'deny');
});

test('receipt chain is intact and every tampering is detected', () => {
  const { A, m } = setup();
  const ledger = [];
  for (const amt of ['10.00', '20.00', '30.00']) {
    ledger.push(receipt({
      mandate: m, ledger, action: 'payment.authorize',
      merchant: 'leroymerlin.fr', amount: EUR(amt), outcome: 'authorized',
    }, A.priv));
  }
  assert.equal(audit(m, ledger).ok, true);
  assert.equal(audit(m, ledger).spent, '60.00');

  const edited = clone(ledger);
  edited[1].amount.amount = '1.00';
  assert.equal(audit(m, edited).ok, false);

  assert.equal(audit(m, clone(ledger).slice(1)).ok, false);
  assert.equal(audit(m, clone(ledger).reverse()).ok, false);

  const forged = clone(ledger);
  forged[2].sig.value = forged[0].sig.value;
  assert.equal(audit(m, forged).ok, false);
});

test('a receipt signed by another agent is rejected', () => {
  const { m } = setup();
  const other = keygen();
  const r = receipt({
    mandate: m, ledger: [], action: 'payment.authorize',
    merchant: 'leroymerlin.fr', amount: EUR('10.00'), outcome: 'authorized',
  }, other.priv);
  assert.equal(audit(m, [r]).ok, false);
});

test('a receipt from another mandate is rejected', () => {
  const { A, m } = setup();
  const second = setup();
  const r = receipt({
    mandate: second.m, ledger: [], action: 'payment.authorize',
    merchant: 'leroymerlin.fr', amount: EUR('10.00'), outcome: 'authorized',
  }, A.priv);
  assert.equal(audit(m, [r]).ok, false);
});
