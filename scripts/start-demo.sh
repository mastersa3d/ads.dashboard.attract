#!/usr/bin/env bash
# Start command for single-instance hosting (e.g. Render): migrate, first-boot bootstrap,
# run the background worker in the same container, then serve the app on $PORT.
set -euo pipefail
npx prisma migrate deploy
npx tsx scripts/seed-if-empty.ts
if [ "${RUN_WORKER_IN_WEB:-false}" = "true" ]; then
  npx tsx worker/index.ts &
fi
exec npx next start -p "${PORT:-3000}"
