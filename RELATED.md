# Related work

Every figure below was checked against the repository itself on 28 September 2026.
Nothing here is quoted from a secondary source, because the secondary sources on
this subject have been wrong in both directions.

| Project | Repository | License | Stars | Commits |
|---|---|---|---|---|
| Visa Trusted Agent Protocol | `visa/trusted-agent-protocol` | MIT | 209 | 6 |
| x402 | `coinbase/x402` | MIT | 162 | 724 |
| Agent Trust Handshake | `ath-protocol/agent-trust-handshake-protocol` | OpenATH (custom) | 61 | 28 |

## What each one is

**Visa Trusted Agent Protocol** — a cryptographic method for an agent to prove
its identity and authorization *to a merchant*, with replay protection. The
closest neighbour to this project, and the overlap is deliberate: proving the
agent is who it claims is the right problem.

Six commits. It is a specification, not a running implementation. That is the
honest gap `open-mandate` fills: both sides here are code you can execute.

**x402** — payment over HTTP. A server answers `402 Payment Required`, the
client pays, the resource is released. Settlement, which this project
deliberately does not do. The two compose: a mandate decides *whether* an agent
may pay, x402 is one way it then *does*.

**Agent Trust Handshake** — a three-party handshake, user plus agent plus
service, where all three must agree. Richer than a two-party mandate, and worth
reading for that reason alone.

## On reuse

Visa TAP and x402 are MIT. You may read, fork, adapt and sell work derived from
them, provided you keep the copyright notice. That is what MIT permits.

ATH carries a custom "OpenATH" licence. A custom licence has to be read in full
before any reuse; the phrase "open source" in a title grants nothing. Until
someone reads it, assume nothing.

`open-mandate` contains no code from any of them.

## What is worth taking

**From Visa TAP** — the framing that the merchant is the party who needs
convincing. That insight is why `src/merchant.js` exists.

**From ATH** — the third party. A mandate binds a human and an agent; the
*service* is only ever a verifier. A handshake where the service also commits
is a stronger model, and this project does not have it yet.

**From x402** — the idea that refusal is a protocol state, not an error. `402`
says "not yet, here is how". `needs_human` is the same shape.

## What could not be verified

Several documents circulating about this space describe an "Agent Interconnection
Protocol" tied to a Chinese national standard GB/Z 185-2026, a "JD A2P2" with six
autonomy levels, and a "UnionPay APOP", complete with launch dates and download
counts. None of it was checked here, and the same documents also carried figures
that turned out to be invented. Treat all of it as unverified until you have
opened the repository yourself.

The same caution applies in reverse: absence of proof here is not proof of
absence. Some of those projects probably exist.
