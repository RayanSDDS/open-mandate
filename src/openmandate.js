// open-mandate 0.1 — signed, offline-verifiable mandates for AI agents.
// Zero dependencies. Node >= 18.

import { generateKeyPairSync, sign as edSign, verify as edVerify,
         createPrivateKey, createPublicKey, createHash, randomUUID } from 'node:crypto';

/* ---------- 1. Canonical JSON ----------
 * A signature over JSON is worthless unless both sides serialize to the SAME
 * bytes. JSON.stringify preserves insertion order, so a merchant who parses and
 * re-serializes gets different bytes than the issuer signed, and verification
 * fails. Keys are sorted RECURSIVELY (RFC 8785). Arrays keep their order:
 * it is meaningful.
 */
const sortDeep = v =>
  Array.isArray(v) ? v.map(sortDeep)
  : (v && typeof v === 'object')
    ? Object.keys(v).sort().reduce((o, k) => (v[k] === undefined ? o : (o[k] = sortDeep(v[k]), o)), {})
    : v;

export const canonical = v => JSON.stringify(sortDeep(v));
export const b64u  = b => Buffer.from(b).toString('base64url');
export const unb64 = s => Buffer.from(s, 'base64url');
export const digest = v => b64u(createHash('sha256').update(canonical(v), 'utf8').digest());
export const clone  = v => JSON.parse(JSON.stringify(v)); // never a shallow copy

/* ---------- 2. Ed25519 keys (node:crypto, nothing installed) ---------- */
export function keygen() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    pub:  b64u(publicKey.export({ type: 'spki',  format: 'der' })),
    priv: b64u(privateKey.export({ type: 'pkcs8', format: 'der' })),
  };
}

export const sign = (priv, msg) =>
  b64u(edSign(null, Buffer.from(msg, 'utf8'),
    createPrivateKey({ key: unb64(priv), format: 'der', type: 'pkcs8' })));

export const verify = (pub, msg, sig) => {
  try {
    return edVerify(null, Buffer.from(msg, 'utf8'),
      createPublicKey({ key: unb64(pub), format: 'der', type: 'spki' }), unb64(sig));
  } catch { return false; }
};

/* ---------- 3. Money as integers, never floats ----------
 * parseFloat('0.1') + parseFloat('0.2') !== 0.3. Forbidden in a payment
 * standard. Amounts are decimal strings, scaled internally to 6 decimals.
 */
export const units = a => {
  if (!a || typeof a.amount !== 'string' || !/^\d+(\.\d{1,6})?$/.test(a.amount)) {
    throw new Error(`invalid amount: ${JSON.stringify(a && a.amount)}`);
  }
  const [i, f = ''] = a.amount.split('.');
  return BigInt(i + (f + '000000').slice(0, 6));
};
const sameCcy = (a, b) => String(a.currency).toUpperCase() === String(b.currency).toUpperCase();
const fmt = u => (Number(u) / 1e6).toFixed(2);

/* ---------- 4. Mandate ---------- */
export function issue({ principalPriv, principalPub, agentPub, agentId, operator,
                        actions, merchants, perTx, total, maxUses,
                        humanAbove, days = 7, purpose, revocationUrl }) {
  const now = new Date();
  const m = {
    omv: '0.1',
    id: `urn:uuid:${randomUUID()}`,
    issued_at:  now.toISOString(),
    expires_at: new Date(now.getTime() + days * 864e5).toISOString(),
    principal: { id: 'did:key:' + principalPub.slice(0, 16), key: principalPub },
    agent:     { id: agentId, operator, key: agentPub },
    grant:     { actions, merchants, purpose },
    limits:    { per_transaction: perTx, total, max_uses: maxUses },
    approval:  { human_above: humanAbove },
  };
  if (revocationUrl) m.revocation = { url: revocationUrl };
  m.sig = {
    alg: 'Ed25519',
    kid: digest(principalPub).slice(0, 16),
    value: sign(principalPriv, canonical(m)),
  };
  return m;
}

/** Offline signature check. No network call, no PSP, no account. */
export function sigOk(m) {
  if (!m || !m.sig || !m.principal || !m.principal.key) return false;
  const { sig, ...rest } = m;      // no delete, no mutation of the caller's object
  return verify(m.principal.key, canonical(rest), sig.value);
}

/* ---------- 5. Decision engine — the differentiator, actually enforced ---------- */
export function decide({ mandate: m, request: r, ledger = [], now = new Date(), revoked = false }) {
  const checks = [];
  const add = (name, ok, detail = '') => { checks.push({ name, ok, detail }); return ok; };

  add('signature', sigOk(m));
  add('not revoked', !revoked);
  add('time window',
      now >= new Date(m.issued_at) && now <= new Date(m.expires_at),
      `${m.issued_at} -> ${m.expires_at}`);
  add('action granted', m.grant.actions.includes(r.action), r.action);
  add('merchant allowed',
      m.grant.merchants.some(x => r.merchant === x || r.merchant.endsWith('.' + x)),
      r.merchant);

  const pt = m.limits.per_transaction;
  const ccyOk = add('currency', sameCcy(r.amount, pt), `${r.amount.currency} vs ${pt.currency}`);

  if (ccyOk) {
    add('per-transaction cap', units(r.amount) <= units(pt),
        `${r.amount.amount} <= ${pt.amount}`);
    const spent = ledger
      .filter(x => x.outcome === 'authorized')
      .reduce((s, x) => s + units(x.amount), 0n);
    add('cumulative cap', spent + units(r.amount) <= units(m.limits.total),
        `${fmt(spent)} + ${r.amount.amount} <= ${m.limits.total.amount}`);
  }
  add('use count', ledger.length < m.limits.max_uses, `${ledger.length}/${m.limits.max_uses}`);

  const failures = checks.filter(c => !c.ok);
  if (failures.length) {
    return { decision: 'deny', checks, reason: failures.map(c => c.name).join(', ') };
  }
  if (units(r.amount) > units(m.approval.human_above)) {
    return {
      decision: 'needs_human', checks,
      reason: `above ${m.approval.human_above.amount} ${m.approval.human_above.currency}`,
    };
  }
  return { decision: 'allow', checks, reason: 'within mandate' };
}

/* ---------- 6. Hash-chained receipts ----------
 * An agent that claims it paid, with no signed receipt, did nothing.
 * Each receipt commits to the previous one, so nothing can be edited,
 * reordered or silently dropped after the fact.
 */
export function receipt({ mandate: m, ledger, action, merchant, amount, outcome, evidence = {} }, agentPriv) {
  const seq  = ledger.length + 1;
  const prev = seq === 1 ? digest(m) : digest(ledger[ledger.length - 1]);
  const rcp = {
    omv: '0.1', type: 'receipt', mandate_id: m.id, seq, prev,
    at: new Date().toISOString(), action, merchant, amount, outcome, evidence,
  };
  rcp.sig = {
    alg: 'Ed25519',
    kid: digest(m.agent.key).slice(0, 16),
    value: sign(agentPriv, canonical(rcp)),
  };
  return rcp;
}

export function audit(m, ledger) {
  const errors = [];
  ledger.forEach((r, i) => {
    const { sig, ...rest } = r;
    if (!sig || !verify(m.agent.key, canonical(rest), sig.value)) {
      errors.push(`receipt ${i + 1}: invalid signature`);
    }
    if (r.mandate_id !== m.id) errors.push(`receipt ${i + 1}: wrong mandate id`);
    if (r.seq !== i + 1) errors.push(`receipt ${i + 1}: bad sequence number ${r.seq}`);
    const expected = i === 0 ? digest(m) : digest(ledger[i - 1]);
    if (r.prev !== expected) errors.push(`receipt ${i + 1}: broken chain`);
  });
  const spent = ledger
    .filter(r => r.outcome === 'authorized')
    .reduce((s, r) => s + units(r.amount), 0n);
  return { ok: errors.length === 0, errors, count: ledger.length, spent: fmt(spent) };
}
