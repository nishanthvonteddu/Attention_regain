#!/usr/bin/env zsh
set -euo pipefail
cd "$(dirname "$0")/.."
node --test tests/*.test.mjs
