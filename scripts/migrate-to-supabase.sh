#!/usr/bin/env bash
#
# Neon -> Supabase one-shot migration runner.
#
# Before running:
#   1. Deploy the app code containing DB_MIGRATION_MAINTENANCE_MODE.
#   2. Set DB_MIGRATION_MAINTENANCE_MODE=1 in Vercel and redeploy.
#   3. Verify /api/announcements returns HTTP 503 and wait at least 60s
#      for in-flight API requests to drain.
#
# Usage:
#   DB_WRITES_FROZEN=YES ./scripts/migrate-to-supabase.sh
#
# The script prompts for connection URLs without echoing them when the
# variables are not already set. Do not paste database URLs into chat.
#
# Required connection URLs:
#   NEON_URL            = source Neon direct or pooled URL
#   SUPABASE_DIRECT_URL = destination direct or session-pooler URL on
#                         port 5432. Do not use transaction pooler 6543
#                         for pg_restore.
#
# Re-run safety:
#   A non-empty Supabase target is rejected unless the operator explicitly
#   sets CONFIRM_SUPABASE_RESET=YES. That override allows --clean --if-exists
#   and deletes pre-existing public objects in the target.
#
# Dump files are git-ignored and created mode 600. Delete them only after
# the Supabase deployment has been stable for 24-48 hours.

set -euo pipefail
umask 077

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DUMP_DIR="${REPO_ROOT}/migrations-data"
DUMP_FILE="${DUMP_DIR}/openfreepik-${TIMESTAMP}.dump"
MAINTENANCE_CHECK_URL="${MAINTENANCE_CHECK_URL:-https://video.chugax.io.vn/api/announcements}"

find_pg_tool() {
  local name="$1"
  local homebrew_path="/opt/homebrew/opt/postgresql@17/bin/${name}"
  if [[ -x "$homebrew_path" ]]; then
    printf "%s" "$homebrew_path"
    return
  fi
  command -v "$name" || {
    echo "ERROR: ${name} is not installed" >&2
    exit 1
  }
}

PG_DUMP="$(find_pg_tool pg_dump)"
PG_RESTORE="$(find_pg_tool pg_restore)"
PSQL="$(find_pg_tool psql)"

prompt_secret_if_missing() {
  local var_name="$1"
  local prompt="$2"
  if [[ -z "${!var_name:-}" ]]; then
    read -r -s -p "$prompt" "$var_name"
    echo ""
  fi
}

url_host_and_port() {
  node - "$1" <<'NODE'
const raw = process.argv[2];
try {
  const url = new URL(raw);
  console.log(`${url.hostname}\t${url.port || "5432"}`);
} catch {
  process.exit(1);
}
NODE
}

list_public_tables() {
  "$PSQL" "$1" -X -qAt -v ON_ERROR_STOP=1 -c \
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
}

list_public_sequences() {
  "$PSQL" "$1" -X -qAt -v ON_ERROR_STOP=1 -c \
    "SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public' ORDER BY sequence_name"
}

row_count() {
  "$PSQL" "$1" -X -qAt -v ON_ERROR_STOP=1 -v table="$2" -c \
    'SELECT count(*) FROM public.:"table"'
}

table_checksum() {
  "$PSQL" "$1" -X -qAt -v ON_ERROR_STOP=1 -v table="$2" -c \
    'COPY (SELECT row_to_json(t)::text FROM public.:"table" AS t ORDER BY row_to_json(t)::text) TO STDOUT' |
    shasum -a 256 |
    awk '{ print $1 }'
}

sequence_state() {
  "$PSQL" "$1" -X -qAt -v ON_ERROR_STOP=1 -v sequence="$2" -c \
    'SELECT last_value::text || chr(124) || is_called::text FROM public.:"sequence"'
}

if [[ "${DB_WRITES_FROZEN:-}" != "YES" ]]; then
  echo "ERROR: refusing to snapshot a live database." >&2
  echo "Set DB_MIGRATION_MAINTENANCE_MODE=1 in Vercel, redeploy, verify" >&2
  echo "${MAINTENANCE_CHECK_URL} returns HTTP 503, wait 60s, then run:" >&2
  echo "  DB_WRITES_FROZEN=YES $0" >&2
  exit 1
fi

echo "==> Preflight: confirm live API maintenance gate"
HTTP_STATUS="$(curl -sS -o /dev/null -w "%{http_code}" \
  --connect-timeout 5 --max-time 15 "$MAINTENANCE_CHECK_URL")"
if [[ "$HTTP_STATUS" != "503" ]]; then
  echo "ERROR: ${MAINTENANCE_CHECK_URL} returned HTTP ${HTTP_STATUS}, expected 503." >&2
  echo "Writes may still reach Neon. Refusing to create a stale snapshot." >&2
  exit 1
fi
echo "    Live API returns HTTP 503"

prompt_secret_if_missing NEON_URL "Neon source URL (hidden): "
prompt_secret_if_missing SUPABASE_DIRECT_URL "Supabase direct/session-pooler URL on port 5432 (hidden): "

if ! SOURCE_HOST_PORT="$(url_host_and_port "$NEON_URL")"; then
  echo "ERROR: NEON_URL is not a valid URL" >&2
  exit 1
fi
if ! TARGET_HOST_PORT="$(url_host_and_port "$SUPABASE_DIRECT_URL")"; then
  echo "ERROR: SUPABASE_DIRECT_URL is not a valid URL" >&2
  exit 1
fi

SOURCE_HOST="${SOURCE_HOST_PORT%%$'\t'*}"
TARGET_HOST="${TARGET_HOST_PORT%%$'\t'*}"
TARGET_PORT="${TARGET_HOST_PORT##*$'\t'}"

if [[ "$SOURCE_HOST" != *.neon.tech ]]; then
  echo "ERROR: source host must be a Neon hostname, got ${SOURCE_HOST}" >&2
  exit 1
fi
if [[ "$TARGET_HOST" != *.supabase.co && "$TARGET_HOST" != *.pooler.supabase.com ]]; then
  echo "ERROR: target host must be a Supabase hostname, got ${TARGET_HOST}" >&2
  exit 1
fi
if [[ "$TARGET_PORT" != "5432" ]]; then
  echo "ERROR: restore target must use port 5432, got ${TARGET_PORT}" >&2
  exit 1
fi

mkdir -p "$DUMP_DIR"
chmod 700 "$DUMP_DIR"
SOURCE_TABLES="$(mktemp "${DUMP_DIR}/source-tables.XXXXXX")"
TARGET_TABLES="$(mktemp "${DUMP_DIR}/target-tables.XXXXXX")"
SOURCE_SEQUENCES="$(mktemp "${DUMP_DIR}/source-sequences.XXXXXX")"
TARGET_SEQUENCES="$(mktemp "${DUMP_DIR}/target-sequences.XXXXXX")"
RESTORE_LOG="$(mktemp "${DUMP_DIR}/restore.XXXXXX.log")"

cleanup() {
  rm -f "$SOURCE_TABLES" "$TARGET_TABLES" "$SOURCE_SEQUENCES" \
    "$TARGET_SEQUENCES" "$RESTORE_LOG"
}
trap cleanup EXIT

echo "==> Preflight: validate source and destination connections"
"$PSQL" "$NEON_URL" -X -qAt -v ON_ERROR_STOP=1 -c "SELECT 1" >/dev/null
"$PSQL" "$SUPABASE_DIRECT_URL" -X -qAt -v ON_ERROR_STOP=1 -c "SELECT 1" >/dev/null
list_public_tables "$NEON_URL" >"$SOURCE_TABLES"
list_public_tables "$SUPABASE_DIRECT_URL" >"$TARGET_TABLES"

if [[ ! -s "$SOURCE_TABLES" ]]; then
  echo "ERROR: Neon source has no public tables" >&2
  exit 1
fi

RESTORE_CLEAN_ARGS=()
if [[ -s "$TARGET_TABLES" ]]; then
  if [[ "${CONFIRM_SUPABASE_RESET:-}" != "YES" ]]; then
    echo "ERROR: Supabase target already contains public tables." >&2
    echo "Refusing to delete target objects without explicit approval." >&2
    echo "For an intentional re-run, set CONFIRM_SUPABASE_RESET=YES." >&2
    exit 1
  fi
  RESTORE_CLEAN_ARGS=(--clean --if-exists)
fi

echo "==> Phase 1: pg_dump from Neon -> $DUMP_FILE"
"$PG_DUMP" \
  "$NEON_URL" \
  --no-owner --no-acl --no-tablespaces \
  --format=custom \
  --file="$DUMP_FILE"
chmod 600 "$DUMP_FILE"

DUMP_SIZE=$(du -h "$DUMP_FILE" | cut -f1)
echo "    Dump complete: $DUMP_SIZE"

echo ""
echo "==> Phase 2: pg_restore into Supabase"
# `set -u` strict-mode-safe expansion of a possibly-empty array. The
# ${arr[@]+"${arr[@]}"} form expands to nothing when the array is unset
# OR empty, instead of erroring out. Standard bash array idiom.
if ! "$PG_RESTORE" \
  --no-owner --no-acl \
  --exit-on-error \
  --dbname="$SUPABASE_DIRECT_URL" \
  ${RESTORE_CLEAN_ARGS[@]+"${RESTORE_CLEAN_ARGS[@]}"} \
  "$DUMP_FILE" >"$RESTORE_LOG" 2>&1; then
  tail -40 "$RESTORE_LOG" >&2
  echo "ERROR: pg_restore failed; refusing to continue to cutover." >&2
  exit 1
fi
tail -20 "$RESTORE_LOG"

echo ""
echo "==> Phase 3: verify table inventory, row counts, checksums, and sequences"
list_public_tables "$SUPABASE_DIRECT_URL" >"$TARGET_TABLES"
if ! diff -u "$SOURCE_TABLES" "$TARGET_TABLES"; then
  echo "ERROR: public table inventory differs after restore" >&2
  exit 1
fi

printf "    %-28s %10s %10s %s\n" "TABLE" "NEON" "SUPABASE" "MATCH"
printf "    %-28s %10s %10s %s\n" "-----" "----" "--------" "-----"

ALL_MATCH=1
while IFS= read -r table; do
  NEON_COUNT="$(row_count "$NEON_URL" "$table")"
  SUPABASE_COUNT="$(row_count "$SUPABASE_DIRECT_URL" "$table")"
  NEON_HASH="$(table_checksum "$NEON_URL" "$table")"
  SUPABASE_HASH="$(table_checksum "$SUPABASE_DIRECT_URL" "$table")"
  if [[ "$NEON_COUNT" == "$SUPABASE_COUNT" && "$NEON_HASH" == "$SUPABASE_HASH" ]]; then
    printf "    %-28s %10s %10s OK\n" "$table" "$NEON_COUNT" "$SUPABASE_COUNT"
  else
    printf "    %-28s %10s %10s MISMATCH\n" "$table" "$NEON_COUNT" "$SUPABASE_COUNT"
    ALL_MATCH=0
  fi
done <"$SOURCE_TABLES"

list_public_sequences "$NEON_URL" >"$SOURCE_SEQUENCES"
list_public_sequences "$SUPABASE_DIRECT_URL" >"$TARGET_SEQUENCES"
if ! diff -u "$SOURCE_SEQUENCES" "$TARGET_SEQUENCES"; then
  echo "ERROR: public sequence inventory differs after restore" >&2
  ALL_MATCH=0
fi

while IFS= read -r sequence; do
  [[ -z "$sequence" ]] && continue
  NEON_STATE="$(sequence_state "$NEON_URL" "$sequence")"
  SUPABASE_STATE="$(sequence_state "$SUPABASE_DIRECT_URL" "$sequence")"
  if [[ "$NEON_STATE" != "$SUPABASE_STATE" ]]; then
    echo "    sequence ${sequence}: MISMATCH (${NEON_STATE} != ${SUPABASE_STATE})"
    ALL_MATCH=0
  fi
done <"$SOURCE_SEQUENCES"

echo ""
if [[ "$ALL_MATCH" != "1" ]]; then
  echo "ERROR: verification mismatch detected. Do not cut over." >&2
  exit 1
fi

echo "All tables, rows, checksums, and sequences match. Migration verified."
echo ""
echo "Next steps:"
echo "  1. Keep DB_MIGRATION_MAINTENANCE_MODE=1 during the cutover."
echo "  2. Update Vercel DATABASE_URL to the Supabase transaction-pooler URL (port 6543)."
echo "  3. Redeploy, run DB health checks, then remove DB_MIGRATION_MAINTENANCE_MODE."
echo "  4. Redeploy again and verify live API flows."
echo "  5. Keep Neon and '$DUMP_FILE' for 24-48h as rollback sources."
