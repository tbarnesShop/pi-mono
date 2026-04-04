#!/bin/zsh
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

export PORT="${PORT:-8486}"
export PI_PATH="${PI_PATH:-/opt/homebrew/bin/pi}"
export PI_WORKDIR="${PI_WORKDIR:-/Users/tbmini/Projects/pi-mono}"
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

cd "$PROJECT_DIR"
exec /opt/homebrew/bin/node dist/server.js
