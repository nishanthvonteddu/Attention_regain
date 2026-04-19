#!/usr/bin/env zsh
set -euo pipefail
cd "$(dirname "$0")/.."
zsh scripts/lint.sh
zsh scripts/build.sh
zsh scripts/test.sh
