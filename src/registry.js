// Local registry of issued mandates.
//
// Honest scope: this is *your* record of what you handed out, on your disk.
// Nothing is sent anywhere. No secret is stored.
//
// Two things it deliberately does NOT do:
//   - claim to anonymize. A principal is identified by a hash of its public
//     key: a stable pseudonym, linkable across every export. Not anonymous,
//     and this file never pretends otherwise.
//   - confuse ceilings with spend. The sum of caps is what an agent COULD
//     have spent. Real spend exists only in signed receipts.

import { mkdirSync, existsSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { digest, units, sigOk } from './openmandate.js';

const fmt = u => (Number(u) / 1e6).toFixed(2);

export function registryPath(dir = 'registry') {
  return join(dir, 'mandates.jsonl');
}

function ensure(file) {
  mkdirSync(dirname(file), { recursive: true });
  if (!existsSync(file)) writeFileSync(file, '');
  return file;
}

/** Record a signed mandate. Refuses anything whose signature does not verify. */
export function registerMandate(mandate, { dir = 'registry' } = {}) {
  if (!sigOk(mandate)) throw new Error('refusing to register: signature invalid');
  const file = ensure(registryPath(dir));

  const already = readRegistry({ dir }).find(e => e.mandate_id === mandate.id);
  if (already) return already;

  const entry = {
    mandate_id: mandate.id,
    mandate_digest: digest(mandate),          // canonical, not JSON.stringify
    issued_at: mandate.issued_at,
    expires_at: mandate.expires_at,
    agent_id: mandate.agent.id,
    agent_kid: digest(mandate.agent.key).slice(0, 16),
    principal_kid: digest(mandate.principal.key).slice(0, 16),
    actions: mandate.grant.actions,
    merchants: mandate.grant.merchants,
    per_transaction: mandate.limits.per_transaction,
    total: mandate.limits.total,
    human_above: mandate.approval.human_above,
  };
  appendFileSync(file, JSON.stringify(entry) + '\n');
  return entry;
}

export function readRegistry({ dir = 'registry' } = {}) {
  const file = registryPath(dir);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}

const tally = list => {
  const o = {};
  for (const k of list) o[k] = (o[k] || 0) + 1;
  return Object.entries(o).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
};

/**
 * @param {object}  [opts]
 * @param {Record<string, object[]>} [opts.ledgers] mandate_id -> receipts.
 *   Without it, actual_spend is null — never zero. Zero would be a lie.
 */
export function getStats({ dir = 'registry', ledgers = null, now = new Date() } = {}) {
  const entries = readRegistry({ dir });

  const ceiling = {};
  for (const e of entries) {
    ceiling[e.total.currency] = (ceiling[e.total.currency] || 0n) + units(e.total);
  }

  let actual = null;
  if (ledgers) {
    const acc = {};
    for (const e of entries) {
      const s = (ledgers[e.mandate_id] || [])
        .filter(r => r.outcome === 'authorized')
        .reduce((t, r) => t + units(r.amount), 0n);
      acc[e.total.currency] = (acc[e.total.currency] || 0n) + s;
    }
    actual = Object.fromEntries(Object.entries(acc).map(([c, u]) => [c, fmt(u)]));
  }

  return {
    total_mandates: entries.length,
    active: entries.filter(e => new Date(e.expires_at) > now).length,
    expired: entries.filter(e => new Date(e.expires_at) <= now).length,
    authorized_ceiling: Object.fromEntries(
      Object.entries(ceiling).map(([c, u]) => [c, fmt(u)])),
    actual_spend: actual,
    top_merchants: tally(entries.flatMap(e => e.merchants)).slice(0, 5),
    top_agents: tally(entries.map(e => e.agent_id)).slice(0, 5),
    by_day: Object.fromEntries(
      tally(entries.map(e => e.issued_at.slice(0, 10))).sort((a, b) => a[0].localeCompare(b[0]))),
  };
}

/**
 * Group the registry for sharing. k-anonymity threshold only; the result is
 * PSEUDONYMOUS, not anonymous, and the metadata says so out loud.
 */
export function exportAggregated({ dir = 'registry', from, to, minCount = 10 } = {}) {
  const fromDate = from ? new Date(from) : new Date(0);
  const toDate = to ? new Date(to) : new Date(8.64e15);
  const rows = readRegistry({ dir }).filter(e => {
    const d = new Date(e.issued_at);
    return d >= fromDate && d <= toDate;
  });

  const groups = {};
  for (const e of rows) {
    const key = e.agent_id + '::' + [...e.merchants].sort().join(',');
    const g = groups[key] ||= {
      agent_id: e.agent_id, merchants: [...e.merchants].sort(),
      currency: e.total.currency, count: 0, _ceiling: 0n,
    };
    g.count += 1;
    g._ceiling += units(e.total);
  }

  const kept = Object.values(groups)
    .filter(g => g.count >= minCount)
    .map(({ _ceiling, ...g }) => ({ ...g, authorized_ceiling: fmt(_ceiling) }));

  return {
    metadata: {
      period: { from: fromDate.toISOString(), to: toDate.toISOString() },
      k_threshold: minCount,
      rows_in_period: rows.length,
      groups_kept: kept.length,
      groups_suppressed: Object.keys(groups).length - kept.length,
      generated_at: new Date().toISOString(),
      privacy: 'PSEUDONYMOUS, not anonymous. Agent ids are carried verbatim. '
             + 'Merchant lists can be identifying on their own. A k-threshold '
             + 'limits small groups; it does not de-identify anyone.',
      value_note: 'authorized_ceiling is the sum of spending LIMITS, not money spent.',
    },
    groups: kept,
  };
}
