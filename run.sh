#!/bin/zsh
# ai-orchestrator launcher
# Loads secrets from .env (gitignored), then starts the orchestrator.

set -a
source "$(dirname "$0")/.env"
set +a

cd "$(dirname "$0")"
exec ~/.bun/bin/bun run src/index.ts config.yaml