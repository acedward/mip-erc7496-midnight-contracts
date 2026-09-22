# The standard lives in the MIP, not here

**The normative text is [MIP-0018, "On-Chain Token Metadata Emission"](https://github.com/midnightntwrk/midnight-improvement-proposals/pull/325)** —
MIP PR #325, file `mips/mip-0018-on-chain-token-metadata.md`, commit `37a3471`,
status Proposed. This repository is that MIP's reference implementation: the
Compact module, the reference contracts, a byte-exact consumer-side decoder and
two fixture corpora.

Earlier revisions of this file carried a second, repo-local copy of the rules.
It is gone on purpose. Two normative texts drift, and when they do nobody can
say which one a contract was written against. Read the MIP for what the bytes
mean; read this file for how this repository implements them.

Where the MIP is cited below, "section N" is a section of the MIP.

## What the MIP fixes, in one paragraph

A contract emits one [MIP-0002](https://github.com/midnightntwrk/midnight-improvement-proposals)
`Misc` event per `(domainSep, kind, key, value)` tuple, named
`pad(32, "mip-0018:token-metadata[v1]")`, with a 256-byte payload:
`domainSep` (32) ‖ `kind` (1) ‖ `key` (32) ‖ `val-type` (1) ‖ `val-len` (1) ‖
`value` (189). A consumer folds those events last-write-wins into a table keyed
by `(contractAddress, domainSep, kind)`. The emitting contract is the only
authority for its own tokens, because a native token's colour is derived from
`(domainSep, contractAddress)` and never transmitted. Sections 1 to 8 are
normative; the example keys of Appendix A are a convention.

## The module

`contracts/TokenMetadata.compact` is the module a conforming contract imports.
It is the API the MIP's Implementation Example describes:

```compact
import "./TokenMetadata" prefix TM_;

TM_emitTokenMetadata(domainSep, kind, key, valType, valLen, value);  // value: Bytes<189>
TM_emitNull(domainSep, kind, key);                                   // val-type 5, val-len 0
TM_emitStandardFields(domainSep, kind, name_, nameLen, symbol_, symbolLen, decimals_);

TM_KIND_UNSHIELDED()   // 0 — unshielded native
TM_KIND_SHIELDED()     // 1 — shielded native
TM_KIND_LEDGER_FLAG()  // 2 — added to the privacy bit: balances in contract state

TM_VAL_TYPE_OPAQUE()   // 0 — bytes, no parsing rule
TM_VAL_TYPE_STRING()   // 1 — valid UTF-8
TM_VAL_TYPE_INTEGER()  // 2 — Uint<8*val-len>, little-endian, val-len 1..31
TM_VAL_TYPE_JSON()     // 3 — ONE complete JSON value (RFC 8259)
TM_VAL_TYPE_URI()      // 4 — valid UTF-8 that parses as an absolute URI
TM_VAL_TYPE_NULL()     // 5 — Null: val-len 0, clears the key's current value

TM_EVENT_NAME()        // pad(32, "mip-0018:token-metadata[v1]")
```

`emitStandardFields` emits MIP Appendix A's three core example fields in order:
`name` (val-type 1), `symbol` (val-type 1) and `decimals` (val-type 2 as
`Uint<128>`, val-len 16). `symbol` is `Bytes<32>` so the module covers Appendix
A's whole 1..32 range.

Implementation notes that are not obvious from the MIP:

- **The payload is one `Bytes[...]` spread.**
  `Bytes[...domainSep, kind, ...key, valType, valLen, ...value]` compiles under
  compactc 0.34.0 and produces exactly the documented 256 bytes.
  `test/probe.test.ts` asserts every offset on real compiled output.
- **val-type 2 is little-endian, and this was measured, not read off.** MIP
  section 2.1 says the meaningful prefix is the canonical Compact serialization
  of `Uint<8 × val-len>`; Appendix A prints `6` as `Uint<128>` =
  `0x06000000000000000000000000000000`. Two independent checks agree with it:
  `@midnight-ntwrk/compact-runtime` 0.19.0's own `convertBigintToBytes(16, 6n)`
  returns those sixteen bytes (and `258n` returns `0201` then NULs), and a
  **compiled** contract's `Uint<128>` ledger cell — `LedgerToken._totalSupply`
  holding 258 — carries the aligned atom `0201` under the compiler-declared
  alignment `{bytes, length: 16}`. So the compiler picks a 16-byte field and the
  VM writes the low byte first. A reader that took these bytes big-endian would
  read `decimals = 6` as 2.6 × 10³⁷.
  One consequence worth stating: because `decimals_` is a `Uint<8>`, its
  16-byte serialization is that one byte followed by fifteen NULs — which is
  byte-for-byte what `Bytes[decimals_, ...pad(188, "")]` already was. Only
  `val-len` changed, from 1 to 16.
- **The event name is one literal**, inside `EVENT_NAME()`. The compiler folds
  the call away — a three-event all-literal publish is still k=7 / 28 rows — so
  there is no cost to keeping the name in exactly one place.
- **An unused module circuit costs nothing downstream.** `emitNull` is exported
  by the module but called by no reference contract, and the compiler emits no
  circuit for it in an importer: every `contracts/managed/<row>/zkir/` tree
  holds exactly the circuits its own `.compact` file declares.
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
  re-padded. The same trimming is why the `Uint<128>` measurement above reads
  `0201` and not `02010000…`.

## The legacy name — read this before trusting an address

The MIP was drafted as PR #315 with `mip-xxxx` standing in for an unassigned
number, and **this repository's Stagenet reference set was deployed under that
placeholder**: event name `mip-xxxx:token-metadata[v1]`, from commit
[`1721636`](https://github.com/acedward/mip-erc7496-midnight-contracts/tree/17216362077b3c48da05f06d3a7b0be1b248e1ff),
blocks 508 432 – 508 599 on 2026-09-18. The event name **is** the layout version
(section 8), so those events are a different format: a conforming MIP-0018 v1
consumer **ignores** them — it does not reject them, and it must not
reinterpret them as `[v1]` of this MIP.

**Nothing was redeployed.** The eleven contracts are still on chain, still
emitting the placeholder name, and `deployments/stagenet-deployment.json` plus
`fixtures/stagenet/` remain the record of exactly what they emitted. What would
it take to move them? Section "Upgrade Path for Existing Contracts" of the MIP:
either a redeployment, or a new emitting circuit inserted by each contract's
maintenance authority. Both cost a new set of addresses or a governance step,
and neither buys anything for a reference deployment whose purpose is already
served.

Two consequences you may care about:

- `contracts/generated/*.compact` and their `contracts/managed/` trees are
  **regenerated** for MIP-0018 and no longer correspond byte-for-byte to the
  contracts on Stagenet. The sources of the deployed set are at `1721636`; the
  `expectedVk` maps committed here are the verifier keys of the *current*
  sources, not of the deployed ones.
- The UmbraDB token indexer deliberately keeps a **second, demonstrative**
  decoder path for the placeholder name, validated under the draft's own rules,
  so the live page can keep showing the Stagenet reference set. That path is
  marked in its code as demonstrative only. `fixtures/legacy-mip-xxxx/` is the
  frozen corpus it pins, and `fixtures/simulator/negative-payloads.json` carries
  the placeholder name as an `ignored` payload so a consumer can pin the
  conforming behaviour from the current corpus alone.

### What the final text changed, beyond the number

| Rule | #315 draft | MIP-0018 |
|---|---|---|
| Event name | `mip-xxxx:token-metadata[v1]` | `mip-0018:token-metadata[v1]` |
| val-type 2 | `1 ≤ val-len ≤ 16`, big-endian assumed; `decimals` one byte | byte-aligned `Uint<8>`..`Uint<248>`, so `1 ≤ val-len ≤ 31`; the canonical **little-endian** Compact serialization; `Uint<128>` (val-len 16) is the emitter default, and a decoder MUST accept every width |
| val-type 3 | any UTF-8; a `metadata/<n>` part was a fragment to reassemble | **ONE complete JSON value** (RFC 8259) — object, array or scalar; a fragment is rejected |
| Multipart values | an Appendix A convention | **none**: section 5.4 defines no multipart representation or reassembly |
| val-type 5 | reserved → reject | **Null**: `val-len` MUST be 0, all 189 value bytes ignored, sets the key's current value to Null without erasing history |
| Reserved val-types | 5–255 | 6–255 |
| `/metadata/` keys | no rule | MUST be valid UTF-8 **RFC 6901** JSON Pointers (only `~0`/`~1` escapes) or the event is rejected; every other key is bytes and is never rejected for its encoding |
| Appendix A | a key registry in spirit | explicitly **informative**: transport acceptance never depends on a key's meaning |

A Null looks like this on the wire, and it is the whole of it:

```
key      = pad(32, "description")
val-type = 5
val-len  = 0
value    = 189 NUL bytes          // emitters SHOULD zero them, consumers MUST ignore them
```

`LMOON` in the reference set does exactly that, in a block after the one that
set `description`, so `fixtures/simulator/` holds both the history and the
cleared current value. A Null is not an empty string, not empty opaque bytes,
and not the JSON literal `null` under val-type 3.

## Reference contracts

| file | what it demonstrates |
|---|---|
| `contracts/NativeShieldedToken.compact` | one static domain, kind 1 (MIP-0011 Fungible profile + events) |
| `contracts/NativeUnshieldedToken.compact` | one static domain, kind 0; its `kind_` argument also builds the "Ledger Liar" |
| `contracts/NativeDualToken.compact` | one domain minted both shielded and unshielded — two rows, one colour |
| `contracts/ShieldedCollection.compact` | one address, one domain per piece: the ERC-1155 / EIP-7496 shape |
| `contracts/LedgerToken.compact` | balances in contract state, kind 2 — the case only events can make visible |
| `contracts/generated/*.compact` | the same eleven tokens with every payload as a compile-time literal |
| `contracts/probe/MetadataProbe.compact` | arbitrary payloads, including the ones a consumer must reject, and the two names it must ignore |

The consumer reference is `test/token-metadata.ts`: a decoder and a validator
that re-implement sections 1, 2.1, 2.2, 3 and 5.1 from the MIP text rather than
importing anything from the contracts, so a disagreement between the two sides
fails a test. Its rejection reasons are `payload_size`, `kind_unknown`,
`key_empty`, `key_pointer_invalid`, `val_type_reserved`, `val_len_too_long` and
`val_type_rule`, applied in payload-offset order; an event under another name is
`ignored`, which is not the same thing as rejected.

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

Widening `decimals` from one byte to sixteen does not move these numbers: the
value is a compile-time literal in the deployed contracts and a `Bytes<189>`
field in the parameterised ones either way.

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
must *ignore* (both legacy names) and the ones it must *apply* even though their
Appendix A projection fails. Every rule the final text changed has a payload on
**each** side of it: a Null with and without a zero `val-len`, a 3-byte and a
32-byte integer, a JSON scalar and a JSON fragment, a valid and an invalid
`/metadata/` pointer.

`fixtures/legacy-mip-xxxx/` is the frozen `mip-xxxx` corpus of the #315 draft,
kept verbatim for consumers that keep a legacy path. It is never regenerated and
nothing in this repository's tests reads it; see its `SOURCE.md`.

`fixtures/stagenet/` is the on-chain record of the Stagenet deployment — also
under the placeholder name, for the reason given above.

See the README for how to regenerate the corpora that are regenerated.
