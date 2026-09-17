#!/usr/bin/env bash
# Report the circuit size (k and rows) of every compiled circuit, without
# generating a single proving key. `zkir mock-compile` does the layout only, so
# this is the cheap way to see what a change to a circuit costs — a proving key
# is roughly 2^k * 128 bytes, and k=19 already means ~134 MB and minutes of
# `zkir`.
#
#   ./scripts/circuit-cost.sh                 every compiled contract
#   ./scripts/circuit-cost.sh NativeDualToken just one
#
# Note that a k>=19 circuit takes a minute or two to mock-compile.
set -euo pipefail

COMPACT_VERSION="${COMPACT_VERSION:-0.34.0}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLATFORM="$(ls "$HOME/.compact/versions/$COMPACT_VERSION" | head -1)"
ZKIR="$HOME/.compact/versions/$COMPACT_VERSION/$PLATFORM/${ZKIR_BIN:-zkir}"

targets=("$@")
if [ "${#targets[@]}" -eq 0 ]; then
  targets=()
  for d in "$ROOT"/contracts/managed/*/; do targets+=("$(basename "$d")"); done
fi

for name in "${targets[@]}"; do
  echo "===== $name"
  for f in "$ROOT/contracts/managed/$name/zkir/"*.zkir; do
    [ -f "$f" ] || continue
    "$ZKIR" mock-compile "$f" 2>&1 | tail -1 | sed "s|$ROOT/contracts/managed/$name/zkir/||"
  done
done
