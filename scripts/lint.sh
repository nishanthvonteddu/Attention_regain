#!/usr/bin/env zsh
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/lint.mjs
