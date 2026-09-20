#!/usr/bin/env bash
set -euo pipefail
url="${LOCAL_DATABASE_URL:-}"
if [[ -z "$url" ]] || ! command -v psql >/dev/null; then echo LOCAL_DB_UNAVAILABLE; exit 2; fi
host="$(node -e "const u=new URL(process.argv[1]);process.stdout.write(u.hostname)" "$url")"
case "${host,,}" in localhost|127.0.0.1|::1) ;; *) echo 'REFUSED_NON_LOCAL_DATABASE' >&2; exit 3;; esac
case "${url,,}" in *supabase*|*production*|*prod*) echo 'REFUSED_PRODUCTION_LIKE_DATABASE' >&2; exit 3;; esac
source_db="$(node -e "const u=new URL(process.argv[1]);process.stdout.write(u.pathname.slice(1))" "$url")"
[[ -n "$source_db" ]] || { echo LOCAL_DB_UNAVAILABLE; exit 2; }
db="inventory_migration_test_${RANDOM}_$$"
test_url="$(node -e "const u=new URL(process.argv[1]);u.pathname='/'+process.argv[2];process.stdout.write(u.href)" "$url" "$db")"
cleanup(){ dropdb --if-exists --maintenance-db="$url" "$db" >/dev/null 2>&1||true; };trap cleanup EXIT
# Clone only a caller-provided local baseline. The harness never fabricates predecessor schema.
createdb --maintenance-db="$url" --template="$source_db" "$db"
psql "$test_url" -v ON_ERROR_STOP=1 -f sql/manual/030_fixed_asset_physical_inventory.sql
# The second pass proves the complete-compatible no-op path.
psql "$test_url" -v ON_ERROR_STOP=1 -f sql/manual/030_fixed_asset_physical_inventory.sql
echo LOCAL_DB_MIGRATION_OK