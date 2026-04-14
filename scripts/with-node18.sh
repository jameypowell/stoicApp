#!/usr/bin/env bash
# Prepend Homebrew node@18 to PATH (matches Dockerfile node:18-alpine).
set -euo pipefail
for p in "/opt/homebrew/opt/node@18/bin" "/usr/local/opt/node@18/bin"; do
  if [[ -x "$p/node" ]]; then
    export PATH="$p:$PATH"
    break
  fi
done
exec "$@"
