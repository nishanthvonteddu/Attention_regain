#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[preflight] repo=$ROOT_DIR"

if [[ ! -f package.json ]]; then
  echo "[preflight] missing package.json"
  exit 1
fi

if [[ ! -f .env.local ]]; then
  echo "[preflight] missing .env.local"
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "[preflight] pnpm is not installed"
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo "[preflight] node_modules is missing"
  exit 1
fi

echo "[preflight] git status"
git status --short

echo "[preflight] running build"
pnpm build

if node -e 'const p=require("./package.json"); process.exit(p.scripts && p.scripts.lint ? 0 : 1)'; then
  echo "[preflight] running lint"
  pnpm lint
else
  echo "[preflight] lint script not defined"
fi

if node -e 'const p=require("./package.json"); process.exit(p.scripts && p.scripts.test ? 0 : 1)'; then
  echo "[preflight] running test"
  pnpm test
else
  echo "[preflight] test script not defined"
fi

echo "[preflight] complete"
