#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f ".codex.env" ]]; then
  echo "Missing .codex.env (expected at $ROOT_DIR/.codex.env)." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source "$ROOT_DIR/.codex.env"
set +a

: "${VERCEL_TOKEN:?Missing VERCEL_TOKEN in .codex.env}"

export NO_UPDATE_NOTIFIER="${NO_UPDATE_NOTIFIER:-1}"
export XDG_CACHE_HOME="${XDG_CACHE_HOME:-/tmp/codex-xdg-cache}"

npx vercel deploy --prod --yes --token "$VERCEL_TOKEN"

