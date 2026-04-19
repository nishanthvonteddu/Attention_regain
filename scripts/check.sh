#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/validate-env.mjs --mode=local
bash scripts/lint.sh
bash scripts/build.sh
bash scripts/test.sh
