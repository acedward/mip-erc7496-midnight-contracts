#!/usr/bin/env bash
# Compile every reference contract with a pinned Compact toolchain.
#
#   ./scripts/compile.sh                  compile all contracts into contracts/managed/<name>/
#   ./scripts/compile.sh NativeShieldedToken   compile just one (name without .compact)
#   ./scripts/compile.sh --check          compile into a temp tree and diff against the committed one
#   SKIP_ZK=true ./scripts/compile.sh     skip proving-key generation (fast; TypeScript output only)
#
# Contracts are compiled ONE AT A TIME on purpose: proving-key generation is the
# memory peak of this toolchain and this repository is developed on a shared,
# memory-tight host. Available memory is printed before each compile.
set -euo pipefail

COMPACT_VERSION="${COMPACT_VERSION:-0.34.0}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$ROOT/contracts"
OUT_DIR="$SRC_DIR/managed"

# The contracts to build, in order. TokenMetadata.compact is a module: it has no
# contract of its own and is compiled transitively by every importer.
CONTRACTS=(
  "probe/MetadataProbe"
  "NativeShieldedToken"
  "NativeUnshieldedToken"
  "NativeDualToken"
  "ShieldedCollection"
  "LedgerToken"
)

CHECK=0
SELECTED=()
for arg in "$@"; do
  case "$arg" in
    --check) CHECK=1 ;;
    -*) echo "unknown flag: $arg" >&2; exit 2 ;;
    *) SELECTED+=("$arg") ;;
  esac
done
if [ "${#SELECTED[@]}" -gt 0 ]; then
  CONTRACTS=("${SELECTED[@]}")
fi

compiler() {
  # `compact compile +<version>` runs that exact toolchain without touching the
  # host default (see README "Toolchain").
  compact compile "+$COMPACT_VERSION" "$@"
}

echo "== compactc $(compiler --version) (language $(compiler --language-version), runtime $(compiler --runtime-version))"

FLAGS=()
if [ "${SKIP_ZK:-}" = "true" ]; then
  FLAGS+=(--skip-zk)
  echo "== SKIP_ZK=true: no proving keys will be generated"
fi

TARGET_ROOT="$OUT_DIR"
if [ "$CHECK" = "1" ]; then
  TARGET_ROOT="$(mktemp -d)"
  trap 'rm -rf "$TARGET_ROOT"' EXIT
  echo "== --check: compiling into $TARGET_ROOT"
fi

for name in "${CONTRACTS[@]}"; do
  src="$SRC_DIR/$name.compact"
  [ -f "$src" ] || { echo "missing source: $src" >&2; exit 1; }
  out="$TARGET_ROOT/$(basename "$name")"
  echo
  echo "== $name"
  echo -n "   memory: "; free -h 2>/dev/null | awk '/^Mem:/ {print "available " $7 " of " $2}' || echo "(free unavailable)"
  mkdir -p "$out"
  compiler ${FLAGS[@]+"${FLAGS[@]}"} "$src" "$out"
done

if [ "$CHECK" = "1" ]; then
  echo
  status=0
  for name in "${CONTRACTS[@]}"; do
    base="$(basename "$name")"
    # .prover keys are not committed (megabytes, regenerable); compare everything else.
    if diff -r -q -x '*.prover' "$OUT_DIR/$base" "$TARGET_ROOT/$base"; then
      echo "== $base: managed/ matches the sources"
    else
      echo "== $base: managed/ DIFFERS from a fresh compile" >&2
      status=1
    fi
  done
  exit "$status"
fi

echo
echo "== done; artefacts in $OUT_DIR"
