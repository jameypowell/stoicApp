#!/usr/bin/env bash
# npm run test:local:full — unit tests + production-tests against local server (Node 18).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
bash scripts/with-node18.sh npm test
for p in $(lsof -ti :3000 2>/dev/null); do kill -9 "$p" 2>/dev/null || true; done
sleep 0.5
NODE_ENV=development bash scripts/with-node18.sh node server.js >/tmp/stoic-local-full-test.log 2>&1 &
sp=$!
sleep 4
export PROD_URL=http://127.0.0.1:3000
bash scripts/with-node18.sh node scripts/production-tests/index.js
code=$?
kill "$sp" 2>/dev/null || true
sleep 0.5
kill -9 "$sp" 2>/dev/null || true
exit "$code"
