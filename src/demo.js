// Self-verifying demo. Every line below is an assertion that passes or fails.
import { keygen, issue, sigOk, decide, receipt, audit, canonical, clone } from './openmandate.js';

const EUR  = a => ({ amount: a, currency: 'EUR' });
const line = () => console.log('-'.repeat(68));

export function demo() {
  let failed = 0, total = 0;
  const expect = (label, got, want) => {
    total++;
    const ok = got === want;
    if (!ok) failed++;
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label.padEnd(46)} ${got}${ok ? '' : `  (expected ${want})`}`);
  };

  const P = keygen(), A = keygen();
  line();
  console.log('1. Ed25519 keys generated (zero external dependencies)');
  console.log(`   principal ${P.pub.slice(0, 32)}...`);
  console.log(`   agent     ${A.pub.slice(0, 32)}...`);

  const m = issue({
    principalPriv: P.priv, principalPub: P.pub, agentPub: A.pub,
    agentId: 'urn:agent:claude-desktop', operator: 'Anthropic',
    actions: ['catalog.read', 'cart.create', 'payment.authorize'],
    merchants: ['hardware.example', 'tools.example'],
    perTx: EUR('500.00'), total: EUR('1500.00'), maxUses: 10,
    humanAbove: EUR('200.00'), purpose: 'Bathroom renovation supplies',
  });
  line();
  console.log('2. Mandate issued');
  console.log(`   ${m.id}`);
  console.log('   <= 500.00 EUR per transaction | <= 1500.00 EUR total | human above 200.00 EUR');

  line();
  console.log('3. Offline verification (merchant side, zero network calls)');
  expect('signature valid', sigOk(m), true);
  expect('signature still valid on 2nd call', sigOk(m), true);
  const raised = clone(m); raised.limits.per_transaction.amount = '50000.00';
  expect('cap raised by attacker -> rejected', sigOk(raised), false);
  const widened = clone(m); widened.grant.merchants.push('attacker.example');
  expect('merchant list widened -> rejected', sigOk(widened), false);
  expect('re-serialized in different key order', sigOk(JSON.parse(canonical(m))), true);

  line();
  console.log('4. Decisions');
  const ledger = [];
  const run = (label, req, want) => {
    const d = decide({ mandate: m, request: req, ledger });
    expect(label, d.decision, want);
    if (d.decision === 'allow') {
      ledger.push(receipt({ mandate: m, ledger, ...req, outcome: 'authorized' }, A.priv));
    }
  };
  run('149.90 EUR at hardware.example',
      { action: 'payment.authorize', merchant: 'hardware.example', amount: EUR('149.90') }, 'allow');
  run('89.00 EUR at tools.example',
      { action: 'payment.authorize', merchant: 'tools.example', amount: EUR('89.00') }, 'allow');
  run('350.00 EUR -> human approval required',
      { action: 'payment.authorize', merchant: 'hardware.example', amount: EUR('350.00') }, 'needs_human');
  run('700.00 EUR -> over per-transaction cap',
      { action: 'payment.authorize', merchant: 'hardware.example', amount: EUR('700.00') }, 'deny');
  run('120.00 EUR at elsewhere.example -> merchant refused',
      { action: 'payment.authorize', merchant: 'elsewhere.example', amount: EUR('120.00') }, 'deny');
  run('refund -> action not granted',
      { action: 'payment.refund', merchant: 'hardware.example', amount: EUR('10.00') }, 'deny');
  run('10.00 USD -> currency mismatch',
      { action: 'payment.authorize', merchant: 'hardware.example', amount: { amount: '10.00', currency: 'USD' } }, 'deny');

  const req = { action: 'payment.authorize', merchant: 'hardware.example', amount: EUR('10.00') };
  expect('after expiry -> denied',
    decide({ mandate: m, request: req, ledger, now: new Date(Date.parse(m.expires_at) + 1000) }).decision, 'deny');
  expect('revoked -> denied',
    decide({ mandate: m, request: req, ledger, revoked: true }).decision, 'deny');

  line();
  console.log('5. Hash-chained audit trail');
  const a0 = audit(m, ledger);
  console.log(`   ${a0.count} receipts, ${a0.spent} EUR authorized`);
  expect('receipt chain intact', a0.ok, true);
  const edited = clone(ledger); edited[0].amount.amount = '9.90';
  expect('receipt amount edited -> detected', audit(m, edited).ok, false);
  expect('receipt dropped -> detected', audit(m, clone(ledger).slice(1)).ok, false);
  expect('receipts reordered -> detected', audit(m, clone(ledger).reverse()).ok, false);

  line();
  console.log(failed === 0 ? `ALL PASS  ${total}/${total}` : `${failed} FAILURE(S) out of ${total}`);
  return failed;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[2] === 'demo') {
  process.exit(demo() === 0 ? 0 : 1);
}
