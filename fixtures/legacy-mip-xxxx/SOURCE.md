# `fixtures/legacy-mip-xxxx/` — the frozen `mip-xxxx:token-metadata[v1]` corpus

These five files are the simulator corpus this repository produced against the
**#315 draft** of the MIP, before a number was assigned. They are kept verbatim,
are not regenerated, and are **not** what a conforming MIP-0018 consumer accepts.

| Field | Value |
|---|---|
| Event name | `mip-xxxx:token-metadata[v1]` — the draft's placeholder |
| Standard | MIP PR #315, `mips/mip-xxxx-on-chain-token-metadata.md` @ `f433056` |
| Frozen from | `fixtures/simulator/` at commit `fbc04e4` (byte-identical since `ed5f034`, which produced them) |
| Producer at the time | `scripts/export-simulator-fixtures.ts` |
| Toolchain | compactc 0.34.0, `@midnight-ntwrk/compact-runtime` 0.19.0 |
| Contents | 69 events, 16 mints, 15 colour vectors, 17 expected token rows over 17 identities, 22 negative/edge payloads |

## Why they are here

Two reasons, and only these two.

1. **The Stagenet reference set on chain emits this name.** It was deployed from
   commit `1721636` (blocks 508 432 – 508 599) while the number was still
   unassigned, and it was *not* redeployed when MIP-0018 landed — the event name
   is the layout version (MIP-0018 section 8), so those events are a different
   format, which a v1 consumer ignores. `fixtures/stagenet/` is the on-chain
   record of that deployment; this directory is its offline counterpart.
2. **A consumer may deliberately keep showing them.** The UmbraDB token indexer
   does, for demonstration purposes, behind a second name with the draft's own
   rules. Its legacy tests need a fixed corpus to pin, and regenerating one is
   impossible: the draft's rules are gone from the generator and the module.

## How the draft's rules differ from MIP-0018

Everything a legacy validator must do differently, and all of it is visible in
these files:

| Rule | #315 draft (this corpus) | MIP-0018 (`fixtures/simulator/`) |
|---|---|---|
| Event name | `mip-xxxx:token-metadata[v1]` | `mip-0018:token-metadata[v1]` |
| val-type 2 integers | `1 ≤ val-len ≤ 16`, read big-endian; `decimals` is one byte | `1 ≤ val-len ≤ 31`, the little-endian Compact `Uint<8·val-len>`; `decimals` is `Uint<128>`, val-len 16 |
| val-type 3 | any UTF-8; a `metadata/<n>` part was a fragment to be reassembled (Appendix A of the draft) | ONE complete JSON value (RFC 8259); a fragment is **rejected** and no reassembly is defined |
| val-type 5 | reserved — reject | **Null**: `val-len` MUST be 0, clears the key's current value |
| Reserved val-types | 5–255 | 6–255 |
| `/metadata/` keys | no rule | MUST be valid UTF-8 RFC 6901 JSON Pointers, or reject |

The concrete consequences in this corpus: SNEB's `metadata` is a six-part
`metadata/0`…`metadata/5` document whose parts are JSON fragments; every
`decimals` event has `val-len` 1; and `negative-payloads.json` records val-type 5
as `val_type_reserved` and a 17-byte integer as `val_type_rule`. Under MIP-0018
the parts reject, `decimals` is sixteen bytes, val-type 5 is Null and a 17-byte
integer is perfectly valid.

## Consumers

Nothing in this repository's test suite reads these files: `test/*.test.ts` assert
the current rules only. They exist for downstream consumers that keep a legacy
path. If you are writing one, `fixtures/simulator/negative-payloads.json` also
carries the placeholder name as an `ignored` payload, so you can pin both
behaviours from the current corpus alone.
