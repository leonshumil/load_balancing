#!/usr/bin/env bash
# Run the tutor function locally with plain Deno (no Docker), on http://localhost:8787.
#
#   tools/tutor-dev.sh            # in-memory store, chunks from tools/.out/chunks.json
#   tools/tutor-dev.sh --db       # the real Supabase database (SUPABASE_URL + TUTOR_DB_KEY in the env file)
#
# Secrets come from supabase/functions/.env (gitignored), e.g.
#   ANTHROPIC_API_KEY=sk-ant-...
#   SUPABASE_URL=https://<ref>.supabase.co      (only for --db)
#   TUTOR_DB_KEY=sb_secret_...                   (only for --db)
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE=supabase/functions/.env
if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE. Create it with: ANTHROPIC_API_KEY=sk-ant-..." >&2
  exit 1
fi
command -v deno >/dev/null || { echo "Deno not found. Install: curl -fsSL https://deno.land/install.sh | sh" >&2; exit 1; }

export TUTOR_DEV=1
export TUTOR_PORT="${TUTOR_PORT:-8787}"
if [ "${1:-}" != "--db" ]; then
  [ -f tools/.out/chunks.json ] || node tools/build-chunks.mjs
  export TUTOR_CHUNKS_FILE=tools/.out/chunks.json
fi
exec deno run --allow-net --allow-env --allow-read --env-file="$ENV_FILE" supabase/functions/tutor/index.ts
