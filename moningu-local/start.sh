#!/bin/bash
set -a
source "$(dirname "$0")/.env"
set +a
exec pnpm --filter @workspace/discord-bot run dev
