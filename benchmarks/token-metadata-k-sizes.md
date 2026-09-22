# Historical token metadata circuit K sizes: Compact and MinoCrab

This is a measured comparison of five equivalent **historical pre-MIP** token-metadata circuits pinned to contract revision `71c5b0b5fc0503187df5fb7bb67687b3a5c55ef6`. It targets the byte-heavy paths in that revision's `MetadataProbe` and uses generated `SSTAR.publishMetadata` as its deployed fixed-literal control. The matching addresses and transactions are preserved in the [pinned Effectstream deployment record](https://github.com/effectstream/staging-tokens-addresses/blob/8eda51c0448c77bb1e1326f738f8ebc6c83f4eaf/stagenet-token-metadata-deployments.md).

These fixtures emit `TokenMetadata` with the earlier five-field payload and use `Bytes<16>` symbols. They do not measure the current MIP implementation, which emits `mip-0018:token-metadata[v1]`, adds normative value-type semantics, and uses `Bytes<32>` symbols for the standard fields.

The follow-up [metadata-shape measurements](token-metadata-shapes.md) cover a user-requested typed format, a ledger-backed publisher, and independent one/two/three-event runtime scaling.

## Results

Compact-v3 and MinoCrab-v3 were measured with the same Compact 0.34.0 bundled `/opt/compactc/zkir-v3 mock-compile` oracle. Compact-v2 is the historical source baseline and was measured separately with that image's bundled v2 oracle.

| Contract and circuit | Compact-v2 | Compact-v3 | MinoCrab-v3 | MinoCrab-v3 vs Compact-v3 |
|---|---:|---:|---:|---:|
| `MetadataProbe.publishRaw` | k19 / 328,671 rows | k17 / 74,247 rows | **k11 / 1,897 rows** | **−72,350 rows (−97.45%); k −6** |
| `MetadataProbe.publishStandard` | k19 / 417,350 rows | k17 / 88,654 rows | **k12 / 3,898 rows** | **−84,756 rows (−95.60%); k −5** |
| `MetadataProbe.publishFixture` | k7 / 23 rows | k7 / 103 rows | k7 / 103 rows | 0 rows; k unchanged |
| `MetadataProbe.calls` | k5 / 24 rows | k6 / 34 rows | k6 / 34 rows | 0 rows; k unchanged |
| `SSTAR.publishMetadata` | k7 / 28 rows | k7 / 120 rows | k7 / 120 rows | 0 rows; k unchanged |

The reduction belongs to the two runtime byte-serialization circuits. The literal publishers and counter getter are controls: MinoCrab matches the Compact-v3 K and row counts exactly. The table does not imply whole-contract savings. No proving time, proving-key bytes, verifier-key bytes, or deployment cost was measured.

K and rows are the backend oracle's reported values. They were not derived by rounding rows to a power of two. The MinoCrab model independently returned the same five MinoCrab-v3 K/row pairs.

## What was held equal

The Rust port preserves the original input order and widths, disclosures, ledger field positions, event order, 256-byte payload, 288-byte `Misc` envelope, counter effects, and SSTAR one-time publication guard. In particular:

- `publishRaw` continues to accept every `Uint<8>` kind and length, including reserved kind `0x80` and lengths `191` and `255`.
- `publishStandard` keeps kind, both lengths, and decimals as unrestricted circuit-level `Uint<8>` values. Consumer-level limits in comments were not added as circuit checks.
- `MetadataProbe._calls` remains Counter field 0.
- `SSTAR._published` remains Boolean cell 0, `_mints` remains Counter field 1, and publication changes only `_published`.
- Every event is the 32-byte NUL-padded legacy name `TokenMetadata` followed by the exact historical 256-byte payload. Trailing NUL bytes are part of the checked envelope.

The focused Docker suite has 11 test functions. Shared preimages cover four raw cases and three standard cases, including 0/255 bytes, 31-byte limb boundaries, lengths 0/190/191/255, reserved and maximum kind bytes, and full name/symbol widths. Positive cases also cover the fixed fixture, counter getter, and SSTAR publisher. `assert_call_compatible` compares typed input/output schemas and public-input vectors and requires both MinoCrab's simulator and Midnight's upstream `IrSource::check` to accept both artifacts.

Tamper tests change one event payload, remove the counter effect, change SSTAR's published read, change only SSTAR's state write, or supply an out-of-range `Uint<8>`. Both the Compact-v3 and MinoCrab-v3 artifacts are required to fail in the simulator and in the upstream VM check. This is strong differential evidence over the checked cases, not a formal equivalence proof or a compiler audit.

## Pins

| Component | Pin |
|---|---|
| Original contracts | [`acedward/mip-erc7496-midnight-contracts` @ `71c5b0b5fc0503187df5fb7bb67687b3a5c55ef6`](https://github.com/acedward/mip-erc7496-midnight-contracts/tree/71c5b0b5fc0503187df5fb7bb67687b3a5c55ef6) |
| MinoCrab | [`sig-net/minocrab` @ `99504f0df6633c2ef8720d060ccb9f141f6d06b7`](https://github.com/sig-net/minocrab/tree/99504f0df6633c2ef8720d060ccb9f141f6d06b7) |
| Midnight ledger crates | [`midnightntwrk/midnight-ledger` @ `04c9c5d9bcebb8d4427d8589fb54d58a55599c14`](https://github.com/midnightntwrk/midnight-ledger/tree/04c9c5d9bcebb8d4427d8589fb54d58a55599c14) |
| Compact toolchain | [official release 0.34.0](https://github.com/LFDT-Minokawa/compact/releases/tag/compactc-v0.34.0): compiler 0.34.0, language 0.26.0, runtime 0.19.0 |
| Measured Compact Docker image | `sha256:8f97b90cee942d479bcc7d3f26b9c193be37c71ea5bbb3857c769b7dc6a7d9fa`; built from the official aarch64 asset below |
| Compact aarch64 asset | `compactc_v0.34.0_aarch64-unknown-linux-musl.zip`; SHA-256 `d3e292c4f48e257dcd6b3d3e3e4743d7d8ea0729f48953eab91a366d44cd026d` |
| Rust Docker image | rustc/cargo 1.95.0; `sha256:6258907abe69656e41cd992e0b705cdcfabcbbe3db374f92ed2d47121282d4a1` |

The benchmark's copied original sources retain the original Apache-2.0 license. Their SHA-256 manifest is in [`minocrab/results/source-sha256.txt`](../minocrab/results/source-sha256.txt), and the complete Rust dependency graph is pinned by [`minocrab/Cargo.lock`](../minocrab/Cargo.lock).

## Artifact manifest

Generated ZKIR and BZKIR files are intentionally not committed. The hashes below identify exactly what was measured; the machine-readable copy is [`minocrab/results/measurements.json`](../minocrab/results/measurements.json).

| Variant | Circuit | ZKIR bytes | ZKIR SHA-256 |
|---|---|---:|---|
| Compact-v2 | `MetadataProbe.publishRaw` | 72,413 | `919e1733852977ba38eebef61afefb4080978c8e9dffe26ff0f601f68a8c6aee` |
| Compact-v2 | `MetadataProbe.publishStandard` | 95,725 | `94325310cb16f0bb9e21f040f48494286875e1b0b73ecb4e903f1a88061153c6` |
| Compact-v2 | `MetadataProbe.publishFixture` | 5,294 | `d6f3ae1e3ac8bf1faf365a4186fc28480b72c99af29fbb9776da6e0998126de3` |
| Compact-v2 | `MetadataProbe.calls` | 992 | `26e84c47d8d64a8d15038852c4bb8488aa3ba39ac0d8b1fae8745d25cfeeb904` |
| Compact-v2 | `SSTAR.publishMetadata` | 6,245 | `1ab1d8d39aecc5933e0d0c268139c8675624668e2386c8359d9b507e35bcaa34` |
| Compact-v3 | `MetadataProbe.publishRaw` | 110,658 | `b95c6c3ea6fd338db524ccc6bd3d5dc59f16f3bfbc1d0ee790c963612ff70903` |
| Compact-v3 | `MetadataProbe.publishStandard` | 142,078 | `54eaeac85c99153b95144127e7abba1e848dde880e6c5dd873b3ae4a1678e794` |
| Compact-v3 | `MetadataProbe.publishFixture` | 1,508 | `a8ff33cfe87c79747a6109c6f9c7a4414f697700ce3f4b271e395384639ee2e0` |
| Compact-v3 | `MetadataProbe.calls` | 536 | `ef6a7a73b7466aa6fb367dea12506129a3004e48b1b598b47d69288da2872614` |
| Compact-v3 | `SSTAR.publishMetadata` | 1,993 | `c8e2b4ad084c7c14b97ed13b14df87864bbc05b4efe9f4a1ed746345de456db7` |
| MinoCrab-v3 | `MetadataProbe.publishRaw` | 4,299 | `323483b6de9b5fa6795477605cd2ae80f4518787c731c65998e526b6dc5db85d` |
| MinoCrab-v3 | `MetadataProbe.publishStandard` | 9,291 | `2aff16c3d96cee774f0e656bd1f364250d23d5e17f758f6df62d9b5ac7847d75` |
| MinoCrab-v3 | `MetadataProbe.publishFixture` | 1,294 | `c1df102b7654bf56c414caca2b8230e3f196ebc874a1d9bdb68785b265c95ef3` |
| MinoCrab-v3 | `MetadataProbe.calls` | 432 | `31195d38fd4ca165fb0157ce25d0b5827cc55e4758ac17b31f11efb9818eb2d5` |
| MinoCrab-v3 | `SSTAR.publishMetadata` | 1,668 | `d853e910ff8aa036b82afad91fe88e7a23cdb292bd2cd0201347415b8276963f` |

## Reproduce

The focused benchmark is documented in [`minocrab/README.md`](../minocrab/README.md). With Docker running on aarch64:

```bash
./minocrab/scripts/reproduce.sh
```

The script first creates a temporary Compact container from the pinned official release URL and checksum. It then compiles both Compact versions without keys, runs the differential suite, emits MinoCrab ZKIR, measures every artifact with the appropriate bundled oracle, runs the independent model cross-check, prints hashes, and removes its temporary image and Docker cache volumes. A prebuilt compatible image can be supplied through `COMPACT_IMAGE`. Captured command and result excerpts from the measured run are in [`minocrab/results/oracle.log`](../minocrab/results/oracle.log); the complete structured result set is in [`minocrab/results/measurements.json`](../minocrab/results/measurements.json).
