# Historical MinoCrab token-metadata reference and benchmarks

This focused crate preserves MinoCrab ports of historical metadata routines and
publishers at their audited source pins. It does not port the repository's
current MIP implementation or the full token, mint, transfer, or ownership
implementations.

The source is intentionally divided by wire-format status:

- [`src/lib.rs`](src/lib.rs) contains exact ports of the pre-MIP five-field
  format pinned at contract revision `71c5b0b5fc0503187df5fb7bb67687b3a5c55ef6`:
  `MetadataProbe.publishRaw`, `publishStandard`, `publishFixture`, `calls`, and
  generated `SSTAR.publishMetadata`;
- [`src/shapes.rs`](src/shapes.rs) contains five user-requested typed benchmark
  examples: `literal3`, `ledger3`, `runtime1`, `runtime2`, and `runtime3`. The
  extra value-type field and 189-byte value are benchmark-local.

Both suites emit the legacy NUL-padded name `TokenMetadata` and use
`Bytes<16>` symbols. The typed examples happen to share the current MIP's
189-byte value width, but they do not use the current event name
`mip-0018:token-metadata[v1]`, its normative tag rules, or its `Bytes<32>`
standard-field symbol. They are not measurements of the current MIP contracts
or deployments.

The original Compact files at revision `71c5b0b5fc0503187df5fb7bb67687b3a5c55ef6` are copied under `compact-src/`. `compact-src/shapes/MetadataShapes.compact` is a clearly isolated comparable fixture for the benchmark-local typed format. MinoCrab and every Rust dependency are pinned by `Cargo.toml` and `Cargo.lock`.

Migration provenance: these files were imported from audited
[`effectstream/staging-tokens-addresses` commit `8eda51c0448c77bb1e1326f738f8ebc6c83f4eaf`](https://github.com/effectstream/staging-tokens-addresses/tree/8eda51c0448c77bb1e1326f738f8ebc6c83f4eaf)
([PR #2](https://github.com/effectstream/staging-tokens-addresses/pull/2)). At that
source commit, 10 typed-shape and 11 historical test functions passed in Docker.
The migration validates byte identity and paths; it does not present those tests
as a new run.

Run the complete Docker workflow from the repository root:

```bash
./minocrab/scripts/reproduce.sh
```

By default, the script builds its Compact container from the [official Compact 0.34.0 release](https://github.com/LFDT-Minokawa/compact/releases/tag/compactc-v0.34.0). It pins the Linux aarch64 asset to SHA-256 `d3e292c4f48e257dcd6b3d3e3e4743d7d8ea0729f48953eab91a366d44cd026d`, the same asset used by the measured image. On another Docker architecture, set `COMPACT_IMAGE` to a compatible image that contains this toolchain at `/opt/compactc`; the script checks that the image exists before starting. The script fetches locked Cargo dependencies during the test build, then uses `--network none` for artifact emission and every cost measurement. It generates no proving or verifier keys.

Set `KEEP_COMPACT_IMAGE=1` to retain the image built from the official asset or `KEEP_DOCKER_VOLUMES=1` to retain the two temporary Cargo volumes. Both are removed by default.

For a focused rerun after dependencies are cached, run these from the crate
root inside the pinned Rust container. The full script mounts `minocrab/` at
`/work`, which is already the crate root.

```bash
cargo test --locked --offline --test equivalence
cargo test --locked --offline --test shapes_equivalence
cargo run --locked --offline --bin emit_zkir -- generated/minocrab-v3
cargo run --locked --offline --bin model_cost
```

`COMPACT_V3_DIR` must point to the fresh Compact-v3 output when running either equivalence target directly. The script compiles all Compact fixtures without proof or verifier keys. Generated artifacts, build targets, Cargo caches, BZKIR, keys, and its generated Dockerfile are ignored.

See the [original K-size comparison](../benchmarks/token-metadata-k-sizes.md), [metadata-shape report](../benchmarks/token-metadata-shapes.md), [historical measurements](results/measurements.json), and [typed-shape measurements](results/metadata-shapes.json).
