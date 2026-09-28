# Contributing

The most useful contribution right now is **review**, not code.

## What helps most

1. **Break the threat model.** Find a way for an agent to spend outside its
   mandate that `decide()` does not catch. Open an issue with the exact JSON.
2. **Break the signature.** Find two different mandates that canonicalize to
   the same bytes, or a mutation that survives verification.
3. **Break the receipt chain.** Find an edit, drop, reorder or replay that
   `audit()` reports as intact.

Any of those three is worth more than a feature.

## Ground rules

- **Zero runtime dependencies.** This is a security primitive. If a change
  needs a package, it belongs in a separate repo.
- **Every behaviour change needs a test** in `test/`, and `npm test` must stay
  green.
- **No float arithmetic on money.** Amounts are decimal strings, compared as
  integers.
- **Do not claim adopters, benchmarks or integrations that do not exist.**
  A pull request that adds a logo, a badge or a "used by" line for something
  unverified will be closed.

## Running things

```bash
npm test      # 18 assertions
npm run demo  # end-to-end scenario, prints ALL PASS
npm run mcp   # MCP server on stdio
```

## Scope

This project authorizes actions. It does not move money, hold keys for you, or
talk to a payment provider. Proposals that add settlement belong in a plugin
repository, not here.
