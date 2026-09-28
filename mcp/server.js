#!/usr/bin/env node
// open-mandate MCP server (stdio, JSON-RPC 2.0). Zero dependencies.
// Exposes mandate verification, decision and audit as tools any MCP client
// can call: Claude Desktop, Claude Code, ChatGPT/Codex, Cursor, VS Code.
//
// It never moves money. It answers one question: is this action inside the
// mandate its human signed? allow / needs_human / deny, with the reason.

import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { sigOk, decide, receipt, audit } from '../src/openmandate.js';

const readJson = p => JSON.parse(readFileSync(p, 'utf8'));
const readLedger = p => (!p || !existsSync(p)) ? []
  : readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

const TOOLS = [
  {
    name: 'mandate_inspect',
    description: 'Read a mandate file and report its signature validity, window, allowed actions, allowed merchants and spending limits. Call this before attempting any action on the user behalf.',
    inputSchema: {
      type: 'object',
      required: ['mandate_path'],
      properties: { mandate_path: { type: 'string', description: 'Path to the mandate JSON file' } },
    },
  },
  {
    name: 'mandate_check',
    description: 'Ask whether a specific action is permitted by the mandate. Returns allow, needs_human or deny, with the exact failing constraint. ALWAYS call this before spending money or committing the user to anything.',
    inputSchema: {
      type: 'object',
      required: ['mandate_path', 'action', 'merchant', 'amount'],
      properties: {
        mandate_path: { type: 'string' },
        action: { type: 'string', description: 'e.g. payment.authorize' },
        merchant: { type: 'string', description: 'merchant host, e.g. leroymerlin.fr' },
        amount: { type: 'string', description: 'decimal string, e.g. "149.90" - never a float' },
        currency: { type: 'string', default: 'EUR' },
        ledger_path: { type: 'string', description: 'Optional JSONL receipt ledger, used for cumulative limits' },
      },
    },
  },
  {
    name: 'mandate_receipt',
    description: 'Record a signed, hash-chained receipt for an action that actually happened. An action with no receipt did not happen: never claim success without calling this.',
    inputSchema: {
      type: 'object',
      required: ['mandate_path', 'agent_key_path', 'ledger_path', 'action', 'merchant', 'amount', 'outcome'],
      properties: {
        mandate_path: { type: 'string' },
        agent_key_path: { type: 'string' },
        ledger_path: { type: 'string' },
        action: { type: 'string' },
        merchant: { type: 'string' },
        amount: { type: 'string' },
        currency: { type: 'string', default: 'EUR' },
        outcome: { type: 'string', enum: ['authorized', 'declined', 'failed'] },
        evidence: { type: 'object', description: 'order id, confirmation number, anything verifiable' },
      },
    },
  },
  {
    name: 'mandate_audit',
    description: 'Verify the receipt chain for a mandate: signatures, ordering, and that nothing was edited or dropped. Returns total authorized spend.',
    inputSchema: {
      type: 'object',
      required: ['mandate_path', 'ledger_path'],
      properties: { mandate_path: { type: 'string' }, ledger_path: { type: 'string' } },
    },
  },
];

function callTool(name, a) {
  if (name === 'mandate_inspect') {
    const m = readJson(a.mandate_path);
    return {
      signature: sigOk(m) ? 'VALID' : 'INVALID',
      id: m.id, issued_at: m.issued_at, expires_at: m.expires_at,
      agent: m.agent, actions: m.grant.actions, merchants: m.grant.merchants,
      limits: m.limits, human_approval_above: m.approval.human_above,
    };
  }
  if (name === 'mandate_check') {
    const m = readJson(a.mandate_path);
    const d = decide({
      mandate: m,
      request: { action: a.action, merchant: a.merchant,
                 amount: { amount: a.amount, currency: a.currency || 'EUR' } },
      ledger: readLedger(a.ledger_path),
    });
    return {
      decision: d.decision, reason: d.reason,
      failing_checks: d.checks.filter(c => !c.ok).map(c => ({ check: c.name, detail: c.detail })),
      next_step: d.decision === 'allow' ? 'proceed, then call mandate_receipt'
        : d.decision === 'needs_human' ? 'stop and ask the human to approve this amount'
        : 'do not proceed; report the failing check to the human',
    };
  }
  if (name === 'mandate_receipt') {
    const m = readJson(a.mandate_path);
    const ledger = readLedger(a.ledger_path);
    const r = receipt({
      mandate: m, ledger, action: a.action, merchant: a.merchant,
      amount: { amount: a.amount, currency: a.currency || 'EUR' },
      outcome: a.outcome, evidence: a.evidence || {},
    }, readFileSync(a.agent_key_path, 'utf8').trim());
    appendFileSync(a.ledger_path, JSON.stringify(r) + '\n');
    return { recorded: true, seq: r.seq, receipt_digest: r.prev, at: r.at };
  }
  if (name === 'mandate_audit') {
    const m = readJson(a.mandate_path);
    return audit(m, readLedger(a.ledger_path));
  }
  throw new Error('unknown tool: ' + name);
}

function reply(id, result) { write({ jsonrpc: '2.0', id, result }); }
function fail(id, code, message) { write({ jsonrpc: '2.0', id, error: { code, message } }); }
function write(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }

function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    return reply(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'open-mandate', version: '0.1.0' },
    });
  }
  if (method === 'notifications/initialized') return;
  if (method === 'tools/list') return reply(id, { tools: TOOLS });
  if (method === 'tools/call') {
    try {
      const out = callTool(params.name, params.arguments || {});
      return reply(id, { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] });
    } catch (e) {
      return reply(id, { content: [{ type: 'text', text: 'error: ' + e.message }], isError: true });
    }
  }
  if (id !== undefined) fail(id, -32601, 'method not found: ' + method);
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    try { handle(JSON.parse(line)); }
    catch (e) { fail(null, -32700, 'parse error: ' + e.message); }
  }
});
