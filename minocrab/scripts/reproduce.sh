#!/usr/bin/env bash
set -euo pipefail

BENCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="$BENCH_DIR/../.work/reproduce"
COMPACT_IMAGE="${COMPACT_IMAGE:-}"
RUST_IMAGE="${RUST_IMAGE:-rust@sha256:6258907abe69656e41cd992e0b705cdcfabcbbe3db374f92ed2d47121282d4a1}"
COMPACTC_URL="https://github.com/LFDT-Minokawa/compact/releases/download/compactc-v0.34.0/compactc_v0.34.0_aarch64-unknown-linux-musl.zip"
COMPACTC_SHA256="d3e292c4f48e257dcd6b3d3e3e4743d7d8ea0729f48953eab91a366d44cd026d"
ALPINE_IMAGE="alpine@sha256:14358309a308569c32bdc37e2e0e9694be33a9d99e68afb0f5ff33cc1f695dce"
CARGO_VOLUME="token-metadata-minocrab-cargo-$$"
TARGET_VOLUME="token-metadata-minocrab-target-$$"
BUILT_COMPACT_IMAGE=""

mkdir -p "$WORK_DIR/compact/v2" "$WORK_DIR/compact/v3" "$WORK_DIR/minocrab-v3"
cleanup() {
  if [ "${KEEP_DOCKER_VOLUMES:-0}" != "1" ]; then
    docker volume rm "$CARGO_VOLUME" "$TARGET_VOLUME" >/dev/null 2>&1 || true
  fi
  if [ -n "$BUILT_COMPACT_IMAGE" ] && [ "${KEEP_COMPACT_IMAGE:-0}" != "1" ]; then
    docker image rm "$BUILT_COMPACT_IMAGE" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

prepare_compact_image() {
  local docker_arch
  local dockerfile="$WORK_DIR/Compact.Dockerfile"

  if [ -n "$COMPACT_IMAGE" ]; then
    docker image inspect "$COMPACT_IMAGE" >/dev/null
    return
  fi

  docker_arch="$(docker info --format '{{.Architecture}}')"
  case "$docker_arch" in
    arm64|aarch64) ;;
    *)
      echo "The pinned official Compact 0.34.0 asset is aarch64. Set COMPACT_IMAGE to a compatible image for Docker architecture $docker_arch." >&2
      exit 65
      ;;
  esac

  BUILT_COMPACT_IMAGE="token-metadata-compactc-0.34.0-arm64:reproduce-$$"
  cat >"$dockerfile" <<EOF
FROM $ALPINE_IMAGE
RUN apk add --no-cache libstdc++ libgcc unzip curl bash
ARG COMPACTC_URL
ARG COMPACTC_SHA256
RUN set -eux; \\
    curl -sSL -o /tmp/compactc.zip "\$COMPACTC_URL"; \\
    echo "\${COMPACTC_SHA256}  /tmp/compactc.zip" | sha256sum -c -; \\
    mkdir -p /opt/compactc; \\
    unzip -q /tmp/compactc.zip -d /opt/compactc; \\
    chmod +x /opt/compactc/compactc /opt/compactc/compactc.bin /opt/compactc/zkir \\
             /opt/compactc/zkir-v3 /opt/compactc/fixup-compact /opt/compactc/format-compact; \\
    rm -f /tmp/compactc.zip
ENV PATH=/opt/compactc:\$PATH
WORKDIR /work
CMD ["compactc", "--version"]
EOF
  docker build --file "$dockerfile" --tag "$BUILT_COMPACT_IMAGE" \
    --build-arg "COMPACTC_URL=$COMPACTC_URL" \
    --build-arg "COMPACTC_SHA256=$COMPACTC_SHA256" "$WORK_DIR"
  COMPACT_IMAGE="$BUILT_COMPACT_IMAGE"
}

prepare_compact_image
docker run --rm --network none "$COMPACT_IMAGE" /opt/compactc/compactc --version
docker volume create "$CARGO_VOLUME" >/dev/null
docker volume create "$TARGET_VOLUME" >/dev/null

compile_compact() {
  local version="$1"
  local source
  local output
  for source in probe/MetadataProbe generated/SSTAR; do
    output="$(basename "$source")"
    if [ "$version" = "v3" ]; then
      docker run --rm --network none --cpus 2 --memory 8g --memory-swap 8g \
        -v "$BENCH_DIR/compact-src:/src:ro" -v "$WORK_DIR/compact:/out" -w /src \
        "$COMPACT_IMAGE" /opt/compactc/compactc --skip-zk --feature-zkir-v3 \
        --sourceRoot ../../../ "/src/$source.compact" "/out/$version/$output"
    else
      docker run --rm --network none --cpus 2 --memory 8g --memory-swap 8g \
        -v "$BENCH_DIR/compact-src:/src:ro" -v "$WORK_DIR/compact:/out" -w /src \
        "$COMPACT_IMAGE" /opt/compactc/compactc --skip-zk \
        --sourceRoot ../../../ "/src/$source.compact" "/out/$version/$output"
    fi
  done
}

compile_compact v2
compile_compact v3

# The user-requested typed format exists only as a v3 benchmark fixture.
docker run --rm --network none --cpus 2 --memory 8g --memory-swap 8g \
  -v "$BENCH_DIR/compact-src:/src:ro" -v "$WORK_DIR/compact:/out" -w /src \
  "$COMPACT_IMAGE" /opt/compactc/compactc --skip-zk --feature-zkir-v3 \
  --sourceRoot ../../../ /src/shapes/MetadataShapes.compact \
  /out/v3/MetadataShapes

docker run --rm --cpus 2 --memory 10g --memory-swap 10g \
  -e CARGO_HOME=/cargo-home -e CARGO_TARGET_DIR=/target -e COMPACT_V3_DIR=/compact-v3 \
  -v "$BENCH_DIR:/work" -v "$WORK_DIR/compact/v3:/compact-v3:ro" \
  -v "$CARGO_VOLUME:/cargo-home" -v "$TARGET_VOLUME:/target" -w /work \
  "$RUST_IMAGE" cargo test --locked --test equivalence

docker run --rm --cpus 2 --memory 10g --memory-swap 10g \
  -e CARGO_HOME=/cargo-home -e CARGO_TARGET_DIR=/target -e COMPACT_V3_DIR=/compact-v3 \
  -v "$BENCH_DIR:/work" -v "$WORK_DIR/compact/v3:/compact-v3:ro" \
  -v "$CARGO_VOLUME:/cargo-home" -v "$TARGET_VOLUME:/target" -w /work \
  "$RUST_IMAGE" cargo test --locked --test shapes_equivalence

docker run --rm --network none --cpus 2 --memory 10g --memory-swap 10g \
  -e CARGO_HOME=/cargo-home -e CARGO_TARGET_DIR=/target \
  -v "$BENCH_DIR:/work" -v "$WORK_DIR:/out" \
  -v "$CARGO_VOLUME:/cargo-home" -v "$TARGET_VOLUME:/target" -w /work \
  "$RUST_IMAGE" cargo run --locked --offline --bin emit_zkir -- /out/minocrab-v3

measure() {
  local oracle="$1"
  local directory="$2"
  local circuit="$3"
  docker run --rm --network none --cpus 1 --memory 4g --memory-swap 4g \
    -e RAYON_NUM_THREADS=1 -v "$directory:/measure" -w /measure \
    "$COMPACT_IMAGE" "/opt/compactc/$oracle" mock-compile "$circuit.zkir"
}

for circuit in publishRaw publishStandard publishFixture calls; do
  measure zkir "$WORK_DIR/compact/v2/MetadataProbe/zkir" "$circuit"
  measure zkir-v3 "$WORK_DIR/compact/v3/MetadataProbe/zkir" "$circuit"
  measure zkir-v3 "$WORK_DIR/minocrab-v3" "$circuit"
done
measure zkir "$WORK_DIR/compact/v2/SSTAR/zkir" publishMetadata
measure zkir-v3 "$WORK_DIR/compact/v3/SSTAR/zkir" publishMetadata
measure zkir-v3 "$WORK_DIR/minocrab-v3" SSTAR-publishMetadata
for circuit in literal3 ledger3 runtime1 runtime2 runtime3; do
  measure zkir-v3 "$WORK_DIR/minocrab-v3" "$circuit"
done

docker run --rm --network none --cpus 2 --memory 10g --memory-swap 10g \
  -e CARGO_HOME=/cargo-home -e CARGO_TARGET_DIR=/target \
  -v "$BENCH_DIR:/work" -v "$CARGO_VOLUME:/cargo-home" -v "$TARGET_VOLUME:/target" \
  -w /work "$RUST_IMAGE" cargo run --locked --offline --bin model_cost

find "$WORK_DIR" -name '*.zkir' -type f -exec shasum -a 256 {} + | sort
