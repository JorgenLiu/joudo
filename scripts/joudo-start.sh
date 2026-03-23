#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$ROOT_DIR"

echo "[joudo] Installing dependencies..."
corepack pnpm install --frozen-lockfile

echo "[joudo] Building web client..."
corepack pnpm --filter @joudo/web build

echo "[joudo] Building bridge..."
corepack pnpm --filter @joudo/bridge build

echo "[joudo] Starting bridge on ${HOST:-0.0.0.0}:${PORT:-8787}..."
exec node apps/bridge/dist/index.js
