# Historical MinoCrab token-metadata costs by publication shape

This report measures five MinoCrab-v3 artifacts that answer four token-metadata design questions. The format is a benchmark-local, user-requested typed variant built from historical contracts pinned at `71c5b0b5fc0503187df5fb7bb67687b3a5c55ef6`. It was not deployed to Stagenet. Historical deployments for the separate five-field fixtures remain in the [pinned Effectstream deployment record](https://github.com/effectstream/staging-tokens-addresses/blob/8eda51c0448c77bb1e1326f738f8ebc6c83f4eaf/stagenet-token-metadata-deployments.md).

The typed payload happens to use the current MIP's 189-byte value width, but the fixture still emits the legacy name `TokenMetadata`, uses benchmark-local value-type tags, and retains the historical `Bytes<16>` symbol shape. It is not equivalent to, and does not measure, the current `mip-0018:token-metadata[v1]` contracts, whose standard fields use `Bytes<32>` symbols.

## Results

Every value below comes from Compact 0.34.0's bundled `/opt/compactc/zkir-v3 mock-compile` oracle. The pinned MinoCrab cost model independently returned the same K/row pairs.

| Requested shape | Runtime source | Events | State included | MinoCrab-v3 result |
|---|---|---:|---|---:|
| Fixed literal publisher | Compile-time literals | 3 | Published read/assert/write | **k7 / 120 rows** |
| Ledger-backed publisher | Six ledger metadata fields | 3 | Published read/assert/write | **k12 / 3,715 rows** |
| Fully runtime typed event | Six circuit arguments | 1 | None | **k11 / 1,914 rows** |
| Independent runtime event scaling | Six arguments per event | 1 / 2 / 3 | None | See measured ladder below |

The ledger-backed row is a representative fixed-kind extraction of the historical publisher shape in pinned `NativeShieldedToken` and `LedgerToken`. It reads domain, name, name length, symbol, symbol length, and decimals from six ledger cells and uses a literal kind. The publication guard is a seventh cell read. Its public input has nine field limbs because each 32-byte field occupies two limbs. The pinned `NativeUnshieldedToken`, whose kind also comes from the ledger, has a different shape and is not represented by the 3,715-row result.

Ledger reads remain runtime work even when application logic prevents later metadata updates. MinoCrab's `LedgerCell::read` witnesses each value and ties it to the ledger transcript with `popeq`; the compiler cannot replace those reads with constructor literals.

## Independent runtime-event ladder

Each event in this ladder receives a different domain, kind, key, value type, value length, and 189-byte value. There is no counter, publication guard, owner check, or other setter state. A complete setter must add its application-specific authorization and state work.

| Artifact | Independently supplied events | MinoCrab-v3 | Growth from previous point |
|---|---:|---:|---:|
| `runtime1` | 1 | **k11 / 1,914 rows** | — |
| `runtime2` | 2 | **k12 / 3,789 rows** | +1,875 rows |
| `runtime3` | 3 | **k13 / 5,672 rows** | +1,883 rows |

The measured one-to-three-event range is close to linear in rows, while K steps at each point. Runtime byte packing therefore remains a material per-event cost: adding the second and third independent events costs about 1.88k rows each in these fixtures. This revises the older Compact-v2 warning about a roughly 26k-row fixed runtime-emission floor for the measured MinoCrab compiler and typed layout. It does not justify extrapolating beyond the three measured points, and it says nothing about proving time, key sizes, fees, or whole-contract cost.

## Typed benchmark format

The `TokenMetadata` event name is NUL-padded to 32 bytes. The payload is exactly 256 bytes and the complete `Misc` envelope is 288 bytes.

| Field | Payload offset | Envelope offset | Width |
|---|---:|---:|---:|
| `domainSep` | 0 | 32 | 32 bytes |
| `kind` | 32 | 64 | 1 byte |
| `key` | 33 | 65 | 32 bytes |
| `valType` | 65 | 97 | 1 byte |
| `valLen` | 66 | 98 | 1 byte |
| `value` | 67 | 99 | 189 bytes |

The examples assign `valType=1` to text and `valType=2` to unsigned integers. These are benchmark-local tags, not a normative upstream enum. `kind`, `valType`, and `valLen` retain their circuit-level `Uint<8>` range of 0 through 255; the tests intentionally include lengths above 189 to confirm that `valLen` is descriptive and does not resize the fixed 189-byte value field.

## Verification evidence

Ten new focused tests compare the Compact-v3 fixtures with their MinoCrab ports. The shared cases cover the exact offsets and 288-byte envelope; literal publication; two different six-field ledger states; runtime bytes 0 and 255; a 31-byte packing boundary; lengths 0, 189, 190, and 255; and independent runtime tuples for one, two, and three events.

Targeted negative cases retain otherwise complete transcripts while changing an event type, length, value, order, or count; changing a ledger read and its witness outputs while preserving the original event; changing the publication guard or write; or supplying an out-of-range `Uint<8>`. Both artifacts must reject each mutation in the MinoCrab simulator and Midnight's upstream `IrSource::check`. Positive shared preimages must be accepted by both. These are finite simulator and IR checks, not full proof generation, on-chain execution, formal equivalence, or a compiler audit.

The eleven historical tests from the [earlier K-size comparison](token-metadata-k-sizes.md) also pass unchanged. All five earlier MinoCrab artifact hashes and byte sizes remain identical.

## Pins and artifacts

| Component | Pin |
|---|---|
| Benchmark base | [`effectstream/staging-tokens-addresses` @ `fc1f4f4630694ffa682b3b0520020437b9c5b839`](https://github.com/effectstream/staging-tokens-addresses/tree/fc1f4f4630694ffa682b3b0520020437b9c5b839) |
| Audited migration source | [`effectstream/staging-tokens-addresses` @ `8eda51c0448c77bb1e1326f738f8ebc6c83f4eaf`](https://github.com/effectstream/staging-tokens-addresses/tree/8eda51c0448c77bb1e1326f738f8ebc6c83f4eaf) |
| Original token reference | [`acedward/mip-erc7496-midnight-contracts` @ `71c5b0b5fc0503187df5fb7bb67687b3a5c55ef6`](https://github.com/acedward/mip-erc7496-midnight-contracts/tree/71c5b0b5fc0503187df5fb7bb67687b3a5c55ef6) |
| MinoCrab | [`sig-net/minocrab` @ `99504f0df6633c2ef8720d060ccb9f141f6d06b7`](https://github.com/sig-net/minocrab/tree/99504f0df6633c2ef8720d060ccb9f141f6d06b7) |
| Midnight ledger crates | [`midnightntwrk/midnight-ledger` @ `04c9c5d9bcebb8d4427d8589fb54d58a55599c14`](https://github.com/midnightntwrk/midnight-ledger/tree/04c9c5d9bcebb8d4427d8589fb54d58a55599c14) |
| Compact toolchain | [Official Compact 0.34.0 release](https://github.com/LFDT-Minokawa/compact/releases/tag/compactc-v0.34.0), language 0.26.0, runtime 0.19.0 |
| Measured Compact image | `sha256:8f97b90cee942d479bcc7d3f26b9c193be37c71ea5bbb3857c769b7dc6a7d9fa` |
| Rust image | rustc/cargo 1.95.0; `sha256:6258907abe69656e41cd992e0b705cdcfabcbbe3db374f92ed2d47121282d4a1` |

| Circuit | ZKIR bytes | ZKIR SHA-256 |
|---|---:|---|
| `literal3` | 1,682 | `de08469650ecf709e6b6bb6e7e02b2e58d5adfedb2bdc258685852a38fcd9763` |
| `ledger3` | 10,843 | `c1b8e4886516eccde652cbd698d4b96e2bce66eebd286127b826b457b954dd6d` |
| `runtime1` | 4,381 | `beac6ec7c85b7fbdd3ebb1061f2abc1fb6bdd2958963886414444afa04ff12dd` |
| `runtime2` | 8,842 | `5b15ed1b6fbe234fe5ed9abd1ef5894667149ea1350f6aff5bb79d875e567d85` |
| `runtime3` | 13,289 | `cf15830b054bef91b100e409dc4c59e43c7dc891f3fd795417995ee489b73608` |

Generated ZKIR/BZKIR is intentionally ignored. The [machine-readable result](../minocrab/results/metadata-shapes.json), [captured output excerpts](../minocrab/results/metadata-shapes-oracle.log), and [source hash manifest](../minocrab/results/metadata-shapes-source-sha256.txt) retain the evidence needed to identify the exact artifacts.

## Reproduce

The [benchmark instructions](../minocrab/README.md) cover both the historical circuits and these shapes. On an aarch64 Docker host:

```bash
./minocrab/scripts/reproduce.sh
```

The script builds a temporary Compact image from the pinned official release asset, compiles fixtures without keys, runs both differential suites, emits MinoCrab ZKIR, measures it with the bundled v3 oracle, runs the independent model, prints hashes, and removes its temporary image and volumes. On another architecture, provide a compatible Compact 0.34.0 image through `COMPACT_IMAGE`.
