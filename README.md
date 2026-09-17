# mip-erc7496-midnight-contracts

On-chain token metadata for Midnight: a standard, a Compact module and reference
contracts that publish a token's `name`, `symbol`, `decimals` and arbitrary
key/value traits as contract events, so an indexer can build a token table
without a registry and without trusting anyone but the emitting contract.

Midnight tokens are ERC-1155-like — one contract mints many tokens, each keyed by
a 32-byte *domain separator*, and the token's colour (its type) is
`persistentCommit([domainSep, contractAddress], pad(32, "midnight:derive_token"))`.
Nothing on chain says what a colour means. This repository fixes that with one
event shape, in the spirit of [EIP-7496 (NFT Dynamic Traits)](https://eips.ethereum.org/EIPS/eip-7496).

**[`TOKEN-METADATA.md`](./TOKEN-METADATA.md) is the standard.** Read that if you
want your own contract to appear in a token indexer. This file is about building
and running what is here.

Status: **experimental**, first proof of concept.

## Layout

```
TOKEN-METADATA.md                    the standard (normative)
contracts/TokenMetadata.compact      the module every conforming contract imports
contracts/NativeShieldedToken.compact    one static domain, shielded  (kind 1)
contracts/NativeUnshieldedToken.compact  one static domain, unshielded (kind 0)
contracts/NativeDualToken.compact        one domain, both kinds (0 and 1)
contracts/ShieldedCollection.compact     one address, one domain per piece
contracts/LedgerToken.compact            balances in contract state (kind 2)
contracts/probe/MetadataProbe.compact    the byte-layout proof; emits arbitrary payloads
contracts/managed/<name>/            compiled output (see below)
scripts/compile.sh                   compile with the pinned toolchain
scripts/circuit-cost.sh              report k and rows without generating keys
test/token-metadata.ts               the payload decoder and the simulator harness
test/*.test.ts                       the tests
```

Each template composes three things: the metadata module, an access-control
module and (where one exists) an OpenZeppelin token module —
`@openzeppelin/compact-contracts@0.4.0-alpha.1`, whose sources declare
`pragma language_version >= 0.26.0` and therefore compile under this toolchain.
OpenZeppelin has no native *unshielded* token module, so
`NativeUnshieldedToken` calls the standard library's `mintUnshieldedToken`
directly.

Two deliberate design points:

- **Minting is not owner-gated** on the native templates. These are reference
  test tokens, and an ownership proof inside an already-large mint circuit buys
  nothing here. Metadata *updates* are owner-gated (OpenZeppelin `Ownable`,
  which authenticates through the `wit_OwnableSK` witness).
- **`name` and `symbol` are passed twice** to the constructors — once as
  `Opaque<"string">` for OpenZeppelin's `name()`/`symbol()` circuits, once as
  NUL-padded bytes for the events. Compact cannot serialise an opaque host value
  into a circuit, so the event path needs the byte form. The deployment script
  derives both from one string.

## Toolchain

Compact **0.34.0** (language 0.26.0, runtime 0.19.0, Midnight ledger 9). It is
installed *beside* whatever the machine's default is:

```sh
compact update --no-set-default 0.34.0   # leaves `compact compile --version` alone
compact compile +0.34.0 --version        # -> 0.34.0
```

`scripts/compile.sh` always calls `compact compile +0.34.0`, so building this
repository never changes the host's default compiler.

Node ≥ 22.12 (`.nvmrc` says 24).

## Install

```sh
npm ci          # reproducible, from the committed lockfile
```

If you ever need to rebuild the lockfile from scratch, note that npm 11 crashes
(`Cannot read properties of null (reading 'edgesOut')`) on this dependency set
while the `overrides` block is present. Install once with the block removed and
`--legacy-peer-deps`, then put it back and install again — the overrides are
what dedupe `@midnight-ntwrk/compact-runtime` to a single 0.19.0 copy.

## Compile

```sh
./scripts/compile.sh                      # all contracts, with proving keys
./scripts/compile.sh NativeShieldedToken  # just one
SKIP_ZK=true ./scripts/compile.sh         # no proving keys — seconds instead of minutes
./scripts/compile.sh --check              # does contracts/managed/ still match the sources?
```

Contracts are compiled **one at a time**: proving-key generation is this
toolchain's memory peak. The script prints available memory before each contract
and refuses to generate keys below 1.5 GiB.

### The `managed/` tree

Committed: the generated TypeScript (`contract/`), the ZKIR (`zkir/`) and the
compiler metadata (`compiler/`). **Not** committed: `keys/`. A single k=19
proving key is 134 MB, both key kinds are a pure function of the committed ZKIR,
and `./scripts/compile.sh` regenerates them in minutes. `--check` compares
everything except `keys/` and passes `--sourceRoot` so the generated source map
does not depend on where the compile ran.

## Proving cost — read this before deploying

Emitting an event whose payload is built from **runtime** values (ledger fields
or circuit arguments — i.e. any real token's metadata) is expensive in ZKIR v2.
Measured with `./scripts/circuit-cost.sh`, which runs `zkir mock-compile` and
needs no keys:

| what is emitted | ZKIR v2 (default) | ZKIR v3 |
|---|---|---|
| a payload of compile-time literals | k=6, 23 rows | k=6, 55 |
| one runtime byte, the rest literal | k=15, 26 422 | k=13, 4 764 |
| a payload built from ledger fields (per event) | k=17, 122 419 | k=15, 27 148 |
| a whole runtime `Bytes<256>`, no concatenation | k=18, 166 241 | k=16, 37 721 |
| `emitTokenMetadata(…, value: Bytes<190>)` | k=19, 328 671 | k=17, 74 247 |
| the same with `value: Bytes<64>` | k=18, 182 102 | k=16, 41 090 |
| `publishMetadata` — three events | k=19, 416 601 | — |
| six events in one circuit | k=20, 832 004 | — |

For scale, OpenZeppelin's shielded `_mint` is k=14 and its `_burn` k=16.

Consequences, all of them already applied here:

- **No circuit emits more than three events.** `NativeDualToken` publishes each
  kind separately (`publishUnshielded` / `publishShielded`); `ShieldedCollection`
  publishes a piece's `name`/`symbol`/`decimals` and leaves `tokenUri` and every
  trait to `setPieceTrait`.
- **Key generation is slow**: a k=19 circuit takes about six minutes of `zkir`
  and produces a 134 MB file. A full build of this repository is roughly an
  hour and a half and about 1.5 GB on disk.
- **ZKIR v3 is uniformly ~4.4× cheaper** and is one switch away
  (`ZKIR_V3=true ./scripts/compile.sh`), but nothing here has yet shown that a
  live Midnight network and proof server accept a v3 verifier key. Settle that
  with a single probe deployment before relying on it.

## Test

```sh
npm test          # vitest, in-process Compact simulator, no network, no proof server
npm run typecheck
```

The tests run every template through `@midnight-ntwrk/compact-runtime`, decode
the `Misc` events the circuits emit, and check them against the standard as
written in `TOKEN-METADATA.md` — the decoder in `test/token-metadata.ts`
deliberately re-implements the layout from the document rather than importing
anything from the contracts, so a disagreement fails a test.

They also check the two properties an indexer depends on: the colour derived off
chain from `(domainSep, address)` equals both the contract's `tokenColor()` and
the colour of the coin it actually mints, and a ledger token's `transfer`
produces no mint effect at all.

One detail worth knowing if you read log events in process: the VM hands over
the 288 serialized event bytes as an aligned value with **trailing NULs
trimmed**, while declaring `length: 288`. Zero-extend before slicing
(`rawMiscBytes` does). An indexer reading `MiscContractEvent.payload` over
GraphQL gets the full 256-byte payload already re-padded.

## The reference set and its fixtures

[`deployments/reference-set.json`](./deployments/reference-set.json) is the
reference deployment as data: eleven rows across all four families, including
the three cases a token table has to render and nobody remembers to build — a
token minted but never described, one described but never minted, and one that
declares itself a ledger token and then mints natively anyway.

```sh
npm run export:fixtures:simulator
```

runs the whole set through the simulator and writes `fixtures/simulator/`:

| file | what is in it |
|---|---|
| `events.json` | every `TokenMetadata` event, with its 256-byte payload as hex |
| `mints.json` | every mint effect a scanner would read out of a transcript |
| `color-vectors.json` | `(domainSep, address) → colour`, checked against each contract's own `tokenColor()` |
| `expected-tokens.json` | the rows an indexer should end up with — all four states: observed, declared, described, inconsistent |
| `negative-payloads.json` | payloads a conforming consumer must reject, emitted on purpose by the probe |

Contract addresses are `sha256("umbra:00020:<row id>")`, so every byte —
including every colour — is reproducible. There are no block heights,
transaction hashes or indexer event ids; those only exist once something is
deployed. An indexer can be written and tested byte-exactly against this corpus
long before a chain is involved.

One subtlety the corpus encodes: a token row is keyed by
`(address, domainSep, kind)` where `kind` is **bit 0** of the kind byte — bit 1
(native versus ledger) is a column, not part of the key. So the "Ledger Liar"
row, which declares kind `2` and then mints natively, is *one* row in the
inconsistent state, not two rows.

## Deploy

The reference set is deployed to **Midnight Stagenet**, a public test network.
Nothing here is worth anything; the deployment wallet holds test tokens only.

### 1. A proof server

    docker run -d --name my-proof-server --memory 6g \
      -p 127.0.0.1:10030:6300 midnightntwrk/proof-server:9.0.0-rc.6

It downloads its public parameters on first start and answers on `/` after
about half a minute. **`9.0.0-rc.6` is the version Stagenet accepts** — verified
2026-09-17 by deploying and calling a contract from this repository (`rc.5` was
never needed). Stop it when you are not proving; it is the memory peak of this
workflow after key generation.

### 2. DUST

A Midnight transaction pays its fee in DUST, which NIGHT generates only once
its UTxO is *registered*. A fresh wallet holds none:

    MN_SEED=<hex> npx tsx scripts/register-dust.ts            # estimate only
    MN_SEED=<hex> MODE=register npx tsx scripts/register-dust.ts

The registration pays its own fee out of the DUST its guaranteed NIGHT UTxO has
already generated, so no second funded wallet and no faucet DUST is needed — but
the NIGHT must have been sitting in the wallet long enough (a few hours at
41 335 000 000 000 SPECK/s per 5 000 NIGHT covers a ~26 DUST fee many times
over). It needs **no proof server**: a registration is signature-only.

Two traps the script documents in its header: the recipe that
`registerNightUtxosForDustGeneration` returns is **already signed**, and signing
it again makes the node reject the transaction as malformed (`Custom error: 192`
= `InputsSignaturesLengthMismatch`); and `validateTransaction` reports
"insufficient dust to cover registration fee allowance: 0 available" on a first
registration, which is a false alarm — the allowance is what the transaction is
about to create.

### 3. Generate, compile, deploy

    npx tsx scripts/generate-literal-contracts.ts      # contracts/generated/*.compact
    ./scripts/compile.sh generated/SSTAR               # one at a time
    MN_SEED=<hex> MN_PROOF_SERVER_URL=http://127.0.0.1:10030 \
      npx tsx scripts/deploy-and-publish.ts SSTAR UCOM LSUN DAUR CNST

With no row arguments every non-optional row runs. The script is **resumable per
row and per step**: `out/deployment.json` records the address and each completed
step and a re-run skips them, so an interrupted deployment is restarted with the
same command. A failing step stops that row only.

`contracts/generated/` holds one contract per token with every metadata payload
as a compile-time literal — see "Proving cost" above for why, and
`scripts/generate-literal-contracts.ts`'s header for what those contracts give
up (no `Ownable`, no constructor arguments). The bytes they emit are exactly the
bytes `contracts/`'s parameterised templates emit.

### 4. Record the fixtures

    npx tsx scripts/export-fixtures.ts

reads the public indexer for every transaction in `out/deployment.json` and
writes `fixtures/stagenet/{raw-tx,events,expected-tokens,color-vectors}.json`:
real transaction bytes, real `MiscContractEvent` payloads, the token rows a
consumer should fold out of them, and the colour for each `(address, domainSep)`
pair. `fixtures/simulator/` is the offline corpus and is not touched.

### Environment

| variable | default |
|---|---|
| `MN_SEED` | — (required; 64-byte BIP-39 seed as hex) |
| `MN_NODE_URL` | `https://rpc.stagenet.shielded.tools` |
| `MN_INDEXER_URL` | `https://indexer.stagenet.shielded.tools/api/v4/graphql` |
| `MN_INDEXER_WS_URL` | `wss://indexer.stagenet.shielded.tools/api/v4/graphql/ws` |
| `MN_PROOF_SERVER_URL` | `http://127.0.0.1:6300` |
| `ROWS` | the rows to run, comma-separated (arguments win) |
| `VERIFY_COLOR_ONCHAIN` | `1` also calls `tokenColor()` once per row (one extra proven transaction each) |

## License

Apache-2.0.
