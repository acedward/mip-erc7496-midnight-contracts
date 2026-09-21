# The standard lives in the MIP, not here

**The normative text is [MIP PR #315, "On-Chain Token Metadata Emission"](https://github.com/midnightntwrk/midnight-improvement-proposals/pull/315)** —
file `mips/mip-xxxx-on-chain-token-metadata.md`, commit `f433056`, status Draft.
This repository is that MIP's reference implementation: the Compact module, the
reference contracts, a byte-exact consumer-side decoder and two fixture corpora.

Earlier revisions of this file carried a second, repo-local copy of the rules.
It is gone on purpose. Two normative texts drift, and when they do nobody can
say which one a contract was written against. Read the MIP for what the bytes
mean; read this file for how this repository implements them.

Where the MIP is cited below, "section N" is a section of the MIP.

## What the MIP fixes, in one paragraph

A contract emits one [MIP-0002](https://github.com/midnightntwrk/midnight-improvement-proposals)
`Misc` event per `(domainSep, kind, key, value)` tuple, named
`pad(32, "mip-xxxx:token-metadata[v1]")`, with a 256-byte payload:
`domainSep` (32) ‖ `kind` (1) ‖ `key` (32) ‖ `val-type` (1) ‖ `val-len` (1) ‖
`value` (189). A consumer folds those events last-write-wins into a table keyed
by `(contractAddress, domainSep, kind)`. The emitting contract is the only
authority for its own tokens, because a native token's colour is derived from
`(domainSep, contractAddress)` and never transmitted. Sections 1 to 8 are
normative; the well-known keys of Appendix A are a convention.

## The module

`contracts/TokenMetadata.compact` is the module a conforming contract imports.
It is the API the MIP's Implementation Example describes:

```compact
import "./TokenMetadata" prefix TM_;

TM_emitTokenMetadata(domainSep, kind, key, valType, valLen, value);  // value: Bytes<189>
TM_emitStandardFields(domainSep, kind, name_, nameLen, symbol_, symbolLen, decimals_);

TM_KIND_UNSHIELDED()   // 0 — unshielded native
TM_KIND_SHIELDED()     // 1 — shielded native
TM_KIND_LEDGER_FLAG()  // 2 — added to the privacy bit: balances in contract state
TM_EVENT_NAME()        // pad(32, "mip-xxxx:token-metadata[v1]")
```

`emitStandardFields` emits MIP Appendix A's three core fields in order: `name`
(val-type 1), `symbol` (val-type 1) and `decimals` (val-type 2, exactly one
byte). `symbol` is `Bytes<32>` so the module covers Appendix A's whole 1..32
range.

Implementation notes that are not obvious from the MIP:

- **The payload is one `Bytes[...]` spread.**
  `Bytes[...domainSep, kind, ...key, valType, valLen, ...value]` compiles under
  compactc 0.34.0 and produces exactly the documented 256 bytes.
  `test/probe.test.ts` asserts every offset on real compiled output.
- **The event name is one literal**, inside `EVENT_NAME()`. The compiler folds
  the call away — a three-event all-literal publish is still k=7 / 28 rows — so
  there is no cost to keeping the name in exactly one place.
- **A constructor cannot emit** (section 6.7). Every reference contract exposes
  `publishMetadata()` (or `publishPiece(…)`) for the deployer to call right
  after deployment.
- **`Opaque<"string">` cannot be serialised into a circuit.** A contract that
  keeps `name`/`symbol` as `Opaque<"string">` for its MIP-0011/0014/0004
  circuits must also hold the byte form for the event path; the parameterised
  templates take both at construction and the deploy script derives both from
  one string.
- **Reading log events in process**: the VM hands over the 288 serialized event
  bytes as an aligned value with trailing NULs **trimmed**, while declaring
  `length: 288`. Zero-extend before slicing (`rawMiscBytes` does). An indexer
  reading `MiscContractEvent.payload` over GraphQL gets the 256 bytes already
  re-padded.

## The placeholder MIP number — read before deploying

`xxxx` in `mip-xxxx:token-metadata[v1]` is a placeholder. The MIP fixes the
final string when a number is assigned on merge, and the event name **is** the
identity of the format (section 8): a consumer accepts an event if and only if
its name matches those 32 bytes.

So every contract deployed today emits an event that a post-merge consumer will
ignore. When the number lands:

1. change the one literal in `TokenMetadata.compact`;
2. regenerate and recompile (`scripts/generate-literal-contracts.ts`,
   `scripts/compile.sh`) — the name is baked into every circuit;
3. **redeploy**, or have each contract's maintenance authority insert a new
   emitting circuit (the MIP's "Upgrade Path for Existing Contracts");
4. change the indexer's one name constant and rebuild its derived tables.

Nothing else in the layout changes. This is a known, accepted cost of
publishing a reference deployment against a draft.

## Reference contracts

| file | what it demonstrates |
|---|---|
| `contracts/NativeShieldedToken.compact` | one static domain, kind 1 (MIP-0011 Fungible profile + events) |
| `contracts/NativeUnshieldedToken.compact` | one static domain, kind 0; its `kind_` argument also builds the "Ledger Liar" |
| `contracts/NativeDualToken.compact` | one domain minted both shielded and unshielded — two rows, one colour |
| `contracts/ShieldedCollection.compact` | one address, one domain per piece: the ERC-1155 / EIP-7496 shape |
| `contracts/LedgerToken.compact` | balances in contract state, kind 2 — the case only events can make visible |
| `contracts/generated/*.compact` | the same eleven tokens with every payload as a compile-time literal |
| `contracts/probe/MetadataProbe.compact` | arbitrary payloads, including the ones a consumer must reject or ignore |

The consumer reference is `test/token-metadata.ts`: a decoder and a validator
that re-implement sections 1, 2.1, 2.2 and 3 from the MIP text rather than
importing anything from the contracts, so a disagreement between the two sides
fails a test. Its rejection reasons are `payload_size`, `kind_unknown`,
`key_empty`, `val_type_reserved`, `val_len_too_long` and `val_type_rule`; an
event under another name is `ignored`, which is not the same thing as rejected.

## Circuit cost
> NOTE These values have been updated in the MIP

The MIP fixes the bytes on the wire, not how a contract assembles them, and the
assembly strategy dominates the proving cost. Measured with
`./scripts/circuit-cost.sh` (ZKIR v2, `zkir mock-compile`, no keys generated):

| what is emitted | k | rows |
|---|---|---|
| three events, every byte a compile-time literal (`SSTAR.publishMetadata`) | 7 | 28 |
| one event, all literal (`CNST.updateOrion1`) | 6 | 23 |
| one event with a runtime `Bytes<189>` value (`setMetadata`) | 19 | 330 369 |
| three events from ledger fields (`NativeShieldedToken.publishMetadata`) | 19 | 467 284 |
| three events from ledger fields (`ShieldedCollection.publishPiece`) | 19 | 470 165 |
| six events in one circuit (before `NativeDualToken` was split) | 20 | 832 004 |

For scale, OpenZeppelin's shielded `_mint` is k=14. A k=19 proving key is about
134 MB and some six minutes of `zkir`; a k=20 key is roughly 270 MB.

Consequences, all applied here: **no circuit emits more than three events**, and
the contracts that are actually deployed are the generated literal ones, which
emit byte-identical payloads for a four-figure factor less proving work
(`test/generated.test.ts` asserts that identity). ZKIR v3 measured ~4.4× cheaper
and is one switch away (`ZKIR_V3=true ./scripts/compile.sh`), but no deployment
has shown a live network accepts a v3 verifier key.

Historical Compact/MinoCrab results and their exact fixtures are archived under
[`benchmarks/`](./benchmarks/) and [`minocrab/`](./minocrab/README.md). Those
fixtures use the earlier `TokenMetadata` event name and `Bytes<16>` symbols.
One experiment also uses a 189-byte value, but matching the current payload
width does not make it a measurement of this MIP format or deployment.

## Fixtures

`fixtures/simulator/` is the offline corpus: the whole reference set executed in
the Compact simulator, with deterministic addresses, so an indexer can be
written and tested byte-exactly before any chain is involved. It carries the
events, the mint effects, the colour vectors, the expected token rows and a
negative corpus with one payload per rejection rule — plus the events a consumer
must *ignore* (the pre-MIP name) and the ones it must *apply* even though their
Appendix A projection fails.

`fixtures/stagenet/` is the same thing recorded from the public Stagenet indexer
for a real deployment.

See the README for how to regenerate both.
