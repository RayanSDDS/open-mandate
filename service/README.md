# open-mandate — hosted service

The free part and the paid part, and why the line sits where it sits.

## Free, forever, Apache-2.0

Issuing a mandate. Verifying its signature. Evaluating a request against it.
Signing and auditing a receipt chain. All of it runs offline, on any machine,
with no account and no network call.

This is not a crippled tier. It is the whole protocol. If the hosted service
disappears tomorrow, every mandate already issued still verifies.

## What genuinely cannot be done offline

**Revocation.** A signed mandate is valid until it expires — that is the point
of offline verification, and it is also the hole. If a key leaks or an agent
misbehaves on Tuesday, a merchant verifying on Wednesday has no way to know.
Someone has to answer, at an address the merchant already trusts, every time,
without going down. That is an operational promise, not a library.

**Independent timestamping.** A receipt signed by the agent proves the agent
said it. It does not prove *when*, and the agent controls its own clock. A
countersignature from a third party with no stake in the outcome does.

**Archival.** A ledger held only by the agent can be lost, and will be lost
precisely when a dispute needs it. Six months is a long time for a JSONL file
on somebody's laptop.

None of these are features to be coded once. They are uptime, custody and
neutrality — which is exactly what people pay for and exactly what you cannot
self-host for free without becoming your own operations team.

## Endpoints

| | |
|---|---|
| `GET /v1/mandates/:id/status` | revocation check — the URL a mandate carries |
| `POST /v1/mandates/:id/revoke` | cancel a mandate before it expires |
| `POST /v1/receipts` | countersign a receipt with an independent clock |
| `GET /v1/mandates/:id/ledger` | archived chain, verifiable by anyone |
| `POST /v1/verify-chain` | server-side audit of an archived chain |

```bash
node service/server.js --port 8787
curl http://127.0.0.1:8787/health
```

Storage is a JSON file on purpose. Swap it for Postgres before anyone depends
on it.

## Pricing

**Not set.** There is no price here because there is no customer yet, and a
number invented today would be a number invented today.

The shape that fits the value: per verified revocation check and per notarized
receipt, since both are per-event costs, with a flat floor for the uptime
promise. Fixing the figures requires talking to people who would actually
sign — until then any table on this page would be decoration.

## Status

Runnable, not production. No authentication, no rate limiting, no persistence
guarantees, no SLA. Do not put real money behind it.
