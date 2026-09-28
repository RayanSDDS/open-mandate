# open-mandate

*[Version française](LISEZMOI.md)*

**A signed permission slip an AI agent can show, and anyone can verify offline.**

An agent asks: *may I pay 149.90 EUR at hardware.example?*
`open-mandate` answers `allow`, `needs_human`, or `deny` — and says exactly which
constraint failed. No account, no API call, no payment provider.

```
OK   149.90 EUR at hardware.example                   allow
OK   350.00 EUR -> human approval required          needs_human
OK   700.00 EUR -> over per-transaction cap         deny
OK   120.00 EUR at elsewhere.example -> merchant refused    deny
OK   receipt amount edited -> detected              false
```

## Try it in 15 seconds

No install, no dependencies. Node 18+ is the only requirement.

```bash
git clone https://github.com/USER/open-mandate && cd open-mandate
npm run demo
```

18 assertions run and print `ALL PASS`. Nothing is downloaded — the crypto is
Node's own `node:crypto`.

## Why it exists

AI agents are being handed spending power faster than anyone is defining the
limits of that power. Today the answer is either "the human clicks confirm every
single time" or "the agent has a card and we hope". There is no portable,
inspectable object that says *this agent, these merchants, this much, until
this date, and above this amount ask me first.*

That object is what this repository is.

It does **not** move money. It authorizes. Settlement stays wherever it already
is — a card, a PSP, a bank transfer, a stablecoin rail.

## What a mandate looks like

```json
{
  "omv": "0.1",
  "id": "urn:uuid:25331759-d11d-491c-ba8d-f257e8163180",
  "issued_at": "2026-09-28T12:56:41.518Z",
  "expires_at": "2026-10-05T12:56:41.518Z",
  "principal": { "id": "did:key:MCowBQYDK2VwAyEA", "key": "<ed25519 spki>" },
  "agent":     { "id": "urn:agent:claude-desktop", "operator": "Anthropic",
                 "key": "<ed25519 spki>" },
  "grant": {
    "actions":   ["payment.authorize", "cart.create"],
    "merchants": ["hardware.example", "tools.example"],
    "purpose":   "Bathroom renovation supplies"
  },
  "limits": {
    "per_transaction": { "amount": "500.00",  "currency": "EUR" },
    "total":           { "amount": "1500.00", "currency": "EUR" },
    "max_uses": 10
  },
  "approval": { "human_above": { "amount": "200.00", "currency": "EUR" } },
  "sig": { "alg": "Ed25519", "kid": "...", "value": "..." }
}
```

## Command line

```bash
mandate keygen  --out principal
mandate keygen  --out agent

mandate issue   --principal-key principal.key --agent-pub agent.pub \
                --agent-id urn:agent:claude-desktop --operator Anthropic \
                --actions payment.authorize,cart.create \
                --merchants hardware.example,tools.example \
                --per-tx 500.00 --total 1500.00 --human-above 200.00 \
                --out mandate.json

mandate inspect mandate.json
mandate check   mandate.json --action payment.authorize \
                --merchant hardware.example --amount 149.90 --ledger ledger.jsonl
mandate receipt mandate.json --agent-key agent.key --action payment.authorize \
                --merchant hardware.example --amount 149.90 --ledger ledger.jsonl
mandate audit   mandate.json --ledger ledger.jsonl
```

`check` exits `0` for allow, `10` for needs_human, `1` for deny — so it drops
straight into a shell script or a CI gate.

## Use it from any agent (MCP)

```json
{
  "mcpServers": {
    "open-mandate": { "command": "node", "args": ["/path/to/open-mandate/mcp/server.js"] }
  }
}
```

Four tools: `mandate_inspect`, `mandate_check`, `mandate_receipt`,
`mandate_audit`. Works with Claude Desktop, Claude Code, Codex, Cursor, VS Code
— anything that speaks MCP.

## Three decisions that make this different

**1. Canonical JSON, not `JSON.stringify`.**
Keys are sorted recursively before signing (RFC 8785). A merchant can parse the
mandate, re-serialize it, pass it through a queue, and the signature still
verifies. Most hand-rolled implementations skip this and break the moment the
document is touched.

**2. The human approval threshold is enforced, not declared.**
`human_above` is not documentation. `decide()` returns `needs_human` and the
caller cannot proceed. A limit nobody checks is decoration.

**3. Receipts are hash-chained.**
Every action produces a receipt signed by the agent, committing to the hash of
the previous one. Edit an amount, drop a line, reorder the file — `audit`
catches it. An action with no receipt did not happen.

That third one came from watching a local model write *"file verified"* about a
file it had never created. Agents claim. Receipts prove.

## Where this sits next to Visa, Stripe and Google

Visa's Trusted Agent Protocol, Stripe's Shared Payment Tokens and Google's AP2
are all real, all published, and all solve the part `open-mandate` deliberately
does not: moving the money. They are settlement-side.

`open-mandate` is the permission slip that can sit in front of any of them. It
is worth using when you want:

| | open-mandate |
|---|---|
| Dependencies | none — `node:crypto` only |
| Verification | fully offline, no account with anyone |
| Settlement rail | none, by design — bring your own |
| Human approval threshold | first-class field, enforced by the verifier |
| Tamper-evident action log | hash-chained signed receipts |
| Money representation | decimal strings, integer arithmetic, never floats |

No claim is made here about what those three protocols do or do not support —
read their specs. The point is that this one is small enough to read in an
afternoon and audit yourself.

## Related work

See [RELATED.md](RELATED.md): Visa TAP, x402 and ATH, with licences and repository figures checked directly.

## Status

Version 0.1, published for review. The schema **will** change based on feedback.
Do not put real money behind it yet. There is no production deployment, no
adopter, and no audit — if you see a claim otherwise anywhere, it is false.

Reviews of the threat model and the schema are the most useful thing you can
contribute right now. Open an issue.

## Tests

```bash
npm test
```

18 tests covering canonicalization, signature forgery, every limit, expiry,
revocation, and five distinct receipt-tampering attacks.

## License

Apache-2.0.
