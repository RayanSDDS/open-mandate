import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { keygen, issue, receipt, clone } from '../src/openmandate.js';
import { registerMandate, readRegistry, getStats, exportAggregated } from '../src/registry.js';

const EUR = a => ({ amount: a, currency: 'EUR' });
// Each test gets its own directory: no shared state, no rm -rf at import time.
const freshDir = () => mkdtempSync(join(tmpdir(), 'om-reg-'));

function mandate(over = {}) {
  const P = keygen(), A = keygen();
  const m = issue({
    principalPriv: P.priv, principalPub: P.pub, agentPub: A.pub,
    agentId: over.agentId || 'urn:agent:claude-desktop', operator: 'test',
    actions: ['payment.authorize'],
    merchants: over.merchants || ['leroymerlin.fr'],
    perTx: EUR('500.00'), total: over.total || EUR('1500.00'), maxUses: 10,
    humanAbove: EUR('200.00'), purpose: 'test',
  });
  return { P, A, m };
}

test('registers a signed mandate and reads it back', () => {
  const dir = freshDir();
  const { m } = mandate();
  const e = registerMandate(m, { dir });
  assert.equal(e.mandate_id, m.id);
  assert.equal(e.agent_id, 'urn:agent:claude-desktop');
  assert.equal(readRegistry({ dir }).length, 1);
});

test('refuses a mandate whose signature does not verify', () => {
  const dir = freshDir();
  const { m } = mandate();
  const forged = clone(m);
  forged.limits.per_transaction.amount = '99999.00';
  assert.throws(() => registerMandate(forged, { dir }), /signature invalid/);
  assert.equal(readRegistry({ dir }).length, 0);
});

test('registering twice does not duplicate', () => {
  const dir = freshDir();
  const { m } = mandate();
  registerMandate(m, { dir });
  registerMandate(m, { dir });
  assert.equal(readRegistry({ dir }).length, 1);
});

test('the stored digest is canonical: key order does not change it', () => {
  const dirA = freshDir(), dirB = freshDir();
  const { m } = mandate();
  const a = registerMandate(m, { dir: dirA });
  const reordered = JSON.parse(JSON.stringify({ sig: m.sig, agent: m.agent, ...m }));
  const b = registerMandate(reordered, { dir: dirB });
  assert.equal(a.mandate_digest, b.mandate_digest);
});

test('no private key is ever written to the registry', () => {
  const dir = freshDir();
  const { P, A, m } = mandate();
  registerMandate(m, { dir });
  const raw = JSON.stringify(readRegistry({ dir }));
  assert.ok(!raw.includes(P.priv));
  assert.ok(!raw.includes(A.priv));
  assert.ok(!raw.includes(P.pub), 'public keys are stored hashed, not verbatim');
});

test('ceilings are summed as integers, and are not called spend', () => {
  const dir = freshDir();
  registerMandate(mandate({ total: EUR('0.10') }).m, { dir });
  registerMandate(mandate({ total: EUR('0.20') }).m, { dir });
  const s = getStats({ dir });
  assert.equal(s.authorized_ceiling.EUR, '0.30');   // float arithmetic gives 0.30000000000000004
  assert.equal(s.total_mandates, 2);
});

test('actual spend is null without receipts, never zero', () => {
  const dir = freshDir();
  registerMandate(mandate().m, { dir });
  assert.equal(getStats({ dir }).actual_spend, null);
});

test('actual spend is computed from authorized receipts only', () => {
  const dir = freshDir();
  const { A, m } = mandate();
  registerMandate(m, { dir });
  const ledger = [];
  for (const [amt, outcome] of [['100.00', 'authorized'], ['400.00', 'declined'], ['50.00', 'authorized']]) {
    ledger.push(receipt({
      mandate: m, ledger, action: 'payment.authorize',
      merchant: 'leroymerlin.fr', amount: EUR(amt), outcome,
    }, A.priv));
  }
  const s = getStats({ dir, ledgers: { [m.id]: ledger } });
  assert.equal(s.actual_spend.EUR, '150.00');
  assert.equal(s.authorized_ceiling.EUR, '1500.00');
});

test('active and expired are counted against a given clock', () => {
  const dir = freshDir();
  const { m } = mandate();
  registerMandate(m, { dir });
  assert.equal(getStats({ dir }).active, 1);
  assert.equal(getStats({ dir, now: new Date(Date.parse(m.expires_at) + 1) }).expired, 1);
});

test('export suppresses groups below the k threshold', () => {
  const dir = freshDir();
  for (let i = 0; i < 3; i++) registerMandate(mandate().m, { dir });
  const out = exportAggregated({ dir, minCount: 10 });
  assert.equal(out.groups.length, 0);
  assert.equal(out.metadata.groups_suppressed, 1);
});

test('export keeps a group once it reaches the threshold', () => {
  const dir = freshDir();
  for (let i = 0; i < 3; i++) registerMandate(mandate().m, { dir });
  const out = exportAggregated({ dir, minCount: 3 });
  assert.equal(out.groups.length, 1);
  assert.equal(out.groups[0].count, 3);
  assert.equal(out.groups[0].authorized_ceiling, '4500.00');
});

test('export separates distinct agents into distinct groups', () => {
  const dir = freshDir();
  registerMandate(mandate({ agentId: 'urn:agent:a' }).m, { dir });
  registerMandate(mandate({ agentId: 'urn:agent:b' }).m, { dir });
  const out = exportAggregated({ dir, minCount: 1 });
  assert.equal(out.groups.length, 2);
});

test('export states plainly that it is pseudonymous, not anonymous', () => {
  const dir = freshDir();
  registerMandate(mandate().m, { dir });
  const out = exportAggregated({ dir, minCount: 1 });
  assert.match(out.metadata.privacy, /PSEUDONYMOUS, not anonymous/);
  assert.match(out.metadata.value_note, /not money spent/);
});

test('export honours the date window', () => {
  const dir = freshDir();
  registerMandate(mandate().m, { dir });
  const past = exportAggregated({ dir, to: '2020-01-01T00:00:00.000Z', minCount: 1 });
  assert.equal(past.metadata.rows_in_period, 0);
  const all = exportAggregated({ dir, minCount: 1 });
  assert.equal(all.metadata.rows_in_period, 1);
});
