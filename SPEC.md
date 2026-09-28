# open-mandate 0.1 — specification

Status: draft, published for review. Breaking changes expected.

## 1. Canonicalization

Before signing or hashing, a document is serialized with keys sorted
recursively by UTF-16 code unit, no insignificant whitespace, arrays left in
order. This is the RFC 8785 subset needed here.

Values with no canonical form are rejected: `NaN`, `Infinity`, and BigInt.
`undefined` properties are dropped.

Rationale: without this, a signature only survives if the exact byte sequence
is preserved end to end, which no real pipeline guarantees.

## 2. Keys and signatures

Ed25519. Public keys are DER SPKI, private keys DER PKCS#8, both base64url.
Signatures are detached, base64url, over the canonical serialization of the
document **with the `sig` member removed**.

`kid` is the first 16 characters of the base64url SHA-256 of the signer's
public key. It is a hint, not an authorization.

## 3. Money

An amount is `{ "amount": "<decimal string>", "currency": "<ISO 4217>" }`.

`amount` matches `^\d+(\.\d{1,6})?$`. Negative amounts are invalid. Comparison
and summation are integer operations at a scale of 6 decimal places. Floating
point is never used.

Two amounts of different currencies are never compared; a mismatch is a denial,
not a conversion.

## 4. Mandate

| Member | Required | Meaning |
|---|---|---|
| `omv` | yes | protocol version, `"0.1"` |
| `id` | yes | `urn:uuid:` identifier |
| `issued_at` / `expires_at` | yes | RFC 3339 UTC |
| `principal.key` | yes | the human or organization that answers for this |
| `agent.id` / `agent.key` | yes | who may present it |
| `grant.actions` | yes | exact-match verb list |
| `grant.merchants` | yes | host list; a request host matches a list entry exactly or as a subdomain of it |
| `limits.per_transaction` | yes | amount |
| `limits.total` | yes | amount, summed over authorized receipts |
| `limits.max_uses` | yes | integer, counts all receipts |
| `approval.human_above` | yes | amount above which the verifier returns `needs_human` |
| `revocation.url` | no | endpoint a verifier may poll |
| `sig` | yes | see 2 |

A mandate does not name a payment instrument, and carries no credential.
Losing one leaks the limits, not the money.

## 5. Decision

`decide()` evaluates, in order: signature, revocation, time window, action,
merchant, currency, per-transaction cap, cumulative cap, use count.

- any failure → `deny`, with every failing check named
- all pass and `amount > approval.human_above` → `needs_human`
- otherwise → `allow`

`needs_human` is not an error. It is the normal path for large amounts and the
reason the mandate can be generous without being dangerous.

## 6. Receipts

```
{ "omv", "type": "receipt", "mandate_id", "seq", "prev", "at",
  "action", "merchant", "amount", "outcome", "evidence", "sig" }
```

`seq` starts at 1. `prev` is the base64url SHA-256 of the canonical previous
receipt, or of the canonical mandate for `seq == 1`. `sig` is by the **agent**
key, not the principal.

`outcome` is `authorized`, `declined` or `failed`. Only `authorized` counts
against `limits.total`.

`audit()` verifies each signature, that `mandate_id` matches, that `seq` is
contiguous from 1, and that each `prev` equals the recomputed hash. It detects
edits, drops, reordering and signature replay.

## 8. Three-party session

A mandate binds two parties: the human and the agent. The service only ever
verifies. That asymmetry lets a merchant accept terms and later deny it ever
saw them, because it signed nothing before the money moved. This section
closes that, following the shape of the Agent Trust Handshake.

Three documents, signed in order, sharing one `session_id`:

| Document | Signed by | Commits to |
|---|---|---|
| `session.proposal` | agent | the mandate digest, the merchant host, an expiry |
| `session.acceptance` | merchant | the proposal digest, the merchant key, **its own terms** |
| `session.confirmation` | agent | the acceptance digest and the terms digest |

`terms` is free-form and is whatever the merchant agrees to be held to: a
returns window, the digest of the price list in force, a dispute address. It is
covered by `terms_digest`, so editing it after the fact invalidates the
merchant's own signature.

A merchant created with `requireSession: true` refuses any purchase without a
valid session. Its receipts then carry `session_id` and `terms_digest`, so a
dispute six months later points at the exact terms all three agreed to.

Sessions expire. They are per merchant, and a session issued against one
mandate is void for another.

## 9. What this does not do

No settlement. No credential storage. No agent identity registry. No key
distribution. No revocation transport beyond an optional URL.

Those are real problems. They are not this document's problems.
