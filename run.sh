#!/bin/sh
# ai-orchestrator launcher
# Loads secrets from .env (gitignored), then starts the orchestrator.

set -a
# shellcheck source=/dev/null
. "$(dirname "$0")/.env"
set +a

cd "$(dirname "$0")" || exit 1
exec ~/.bun/bin/bun run src/index.ts config.yaml