#!/usr/bin/env bash
set -euo pipefail
command -v gitleaks >/dev/null
mkdir -p ops
for dir in "$@"; do
  name="$(basename "$dir")"
  gitleaks detect --source "$dir" --log-opts="--all" --redact --report-format json --report-path "ops/gitleaks-$name.json" --exit-code 0
  count=$(node -e "const r=JSON.parse(require('fs').readFileSync('ops/gitleaks-$name.json','utf8'));console.log(r.length)")
  printf '%s findings=%s\n' "$dir" "$count"
done
