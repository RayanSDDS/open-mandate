#!/usr/bin/env node
// open-mandate CLI. Zero dependencies.
import { readFileSync, writeFileSync, appendFileSync, existsSync, chmodSync } from 'node:fs';
import { keygen, issue, sigOk, decide, receipt, audit } from '../src/openmandate.js';
import { demo } from '../src/demo.js';

const argv = process.argv.slice(2);
const cmd = argv[0];

function opt(name, fallback) {
  const i = argv.indexOf('--' + name);
  if (i === -1) return fallback;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) return true;
  return v;
}
const need = name => {
  const v = opt(name);
  if (v === undefined) die(`missing --${name}`);
  return v;
};
const die = msg => { console.error('error: ' + msg); process.exit(2); };
const money = (s, ccy) => ({ amount: String(s), currency: ccy });
const readJson = p => JSON.parse(readFileSync(p, 'utf8'));
const readLedger = p => (!p || !existsSync(p)) ? []
  : readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

const USAGE = `open-mandate — signed, offline-verifiable mandates for AI agents

  mandate keygen   --out <prefix>
  mandate issue    --principal-key <file.key> --agent-pub <file.pub> --agent-id <id>
                   [--operator <name>] --actions a,b,c --merchants x.fr,y.fr
                   --per-tx <amount> --total <amount> [--currency EUR]
                   --human-above <amount> [--max-uses 10] [--days 7]
                   [--purpose "..."] [--revocation-url <url>] --out <file.json>
  mandate inspect  <mandate.json>
  mandate check    <mandate.json> --action <a> --merchant <host> --amount <n>
                   [--currency EUR] [--ledger <file.jsonl>] [--revoked]
  mandate receipt  <mandate.json> --agent-key <file.key> --action <a>
                   --merchant <host> --amount <n> [--currency EUR]
                   [--outcome authorized] --ledger <file.jsonl>
  mandate audit    <mandate.json> --ledger <file.jsonl>
  mandate demo
`;

switch (cmd) {
  case 'keygen': {
    const out = opt('out', 'key');
    const k = keygen();
    writeFileSync(`${out}.key`, k.priv + '\n', { mode: 0o600 });
    writeFileSync(`${out}.pub`, k.pub + '\n');
    try { chmodSync(`${out}.key`, 0o600); } catch {}
    console.log(`private key -> ${out}.key   (keep secret, chmod 600)`);
    console.log(`public key  -> ${out}.pub`);
    break;
  }

  case 'issue': {
    const ccy = opt('currency', 'EUR');
    const principalPriv = readFileSync(need('principal-key'), 'utf8').trim();
    const agentPub = readFileSync(need('agent-pub'), 'utf8').trim();
    const principalPub = opt('principal-pub')
      ? readFileSync(opt('principal-pub'), 'utf8').trim()
      : readFileSync(need('principal-key').replace(/\.key$/, '.pub'), 'utf8').trim();
    const m = issue({
      principalPriv, principalPub, agentPub,
      agentId: need('agent-id'),
      operator: opt('operator', 'unknown'),
      actions: String(need('actions')).split(','),
      merchants: String(need('merchants')).split(','),
      perTx: money(need('per-tx'), ccy),
      total: money(need('total'), ccy),
      maxUses: Number(opt('max-uses', 10)),
      humanAbove: money(need('human-above'), ccy),
      days: Number(opt('days', 7)),
      purpose: opt('purpose', ''),
      revocationUrl: opt('revocation-url', undefined),
    });
    const out = opt('out');
    const json = JSON.stringify(m, null, 2);
    if (out && out !== true) { writeFileSync(out, json + '\n'); console.log(`mandate -> ${out}`); }
    else console.log(json);
    break;
  }

  case 'inspect': {
    const m = readJson(argv[1] || die('missing mandate file'));
    console.log(`id            ${m.id}`);
    console.log(`signature     ${sigOk(m) ? 'VALID' : 'INVALID'}`);
    console.log(`window        ${m.issued_at} -> ${m.expires_at}`);
    console.log(`agent         ${m.agent.id} (${m.agent.operator})`);
    console.log(`actions       ${m.grant.actions.join(', ')}`);
    console.log(`merchants     ${m.grant.merchants.join(', ')}`);
    console.log(`per tx        ${m.limits.per_transaction.amount} ${m.limits.per_transaction.currency}`);
    console.log(`total         ${m.limits.total.amount} ${m.limits.total.currency}`);
    console.log(`human above   ${m.approval.human_above.amount} ${m.approval.human_above.currency}`);
    console.log(`max uses      ${m.limits.max_uses}`);
    process.exit(sigOk(m) ? 0 : 1);
  }

  case 'check': {
    const m = readJson(argv[1] || die('missing mandate file'));
    const d = decide({
      mandate: m,
      request: {
        action: need('action'), merchant: need('merchant'),
        amount: money(need('amount'), opt('currency', 'EUR')),
      },
      ledger: readLedger(opt('ledger')),
      revoked: opt('revoked', false) === true,
    });
    for (const c of d.checks) console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name.padEnd(22)} ${c.detail}`);
    console.log(`\n${d.decision.toUpperCase()}  (${d.reason})`);
    process.exit(d.decision === 'allow' ? 0 : d.decision === 'needs_human' ? 10 : 1);
  }

  case 'receipt': {
    const m = readJson(argv[1] || die('missing mandate file'));
    const ledgerPath = need('ledger');
    const ledger = readLedger(ledgerPath);
    const r = receipt({
      mandate: m, ledger,
      action: need('action'), merchant: need('merchant'),
      amount: money(need('amount'), opt('currency', 'EUR')),
      outcome: opt('outcome', 'authorized'),
    }, readFileSync(need('agent-key'), 'utf8').trim());
    appendFileSync(ledgerPath, JSON.stringify(r) + '\n');
    console.log(`receipt #${r.seq} appended to ${ledgerPath}`);
    break;
  }

  case 'audit': {
    const m = readJson(argv[1] || die('missing mandate file'));
    const a = audit(m, readLedger(need('ledger')));
    console.log(`${a.count} receipts, ${a.spent} ${m.limits.total.currency} authorized`);
    if (a.ok) console.log('chain INTACT');
    else { console.log('chain BROKEN'); for (const e of a.errors) console.log('  ' + e); }
    process.exit(a.ok ? 0 : 1);
  }

  case 'demo':
    process.exit(demo() === 0 ? 0 : 1);

  default:
    console.log(USAGE);
    process.exit(cmd ? 2 : 0);
}
