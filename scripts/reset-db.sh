#!/usr/bin/env bash

# Reset the local TaskNebula database. This permanently deletes its data.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

env_value() {
  local file="$1"
  local key="$2"

  [[ -f "$file" ]] || return 0
  awk -v key="$key" '
    index($0, key "=") == 1 { value = substr($0, length(key) + 2) }
    END { print value }
  ' "$file"
}

database_url="${DATABASE_URL:-$(env_value .env DATABASE_URL)}"
database_name="${POSTGRES_DB:-$(env_value .env POSTGRES_DB)}"
database_user="${POSTGRES_USER:-$(env_value .env POSTGRES_USER)}"
database_password="${POSTGRES_PASSWORD:-$(env_value .env POSTGRES_PASSWORD)}"
database_port="${DB_PORT:-$(env_value .env DB_PORT)}"
database_name="${database_name:-tasknebula}"
database_user="${database_user:-postgres}"
database_port="${database_port:-5432}"
database_host=''

if [[ -n "$database_url" ]]; then
  database_name="$(DATABASE_URL="$database_url" node -e '
    const url = new URL(process.env.DATABASE_URL);
    process.stdout.write(decodeURIComponent(url.pathname.replace(/^\//, "")));
  ')"
  database_host="$(DATABASE_URL="$database_url" node -e '
    process.stdout.write(new URL(process.env.DATABASE_URL).hostname);
  ')"

  if [[ "$database_host" != 'localhost' && "$database_host" != '127.0.0.1' &&
    "$database_host" != '::1' && "$database_host" != 'postgres' &&
    "${TASKNEBULA_ALLOW_REMOTE_DB_RESET:-0}" != '1' ]]; then
    printf 'Error: refusing to reset non-local database host %q.\n' "$database_host" >&2
    printf 'Set TASKNEBULA_ALLOW_REMOTE_DB_RESET=1 only after independently verifying the target.\n' >&2
    exit 1
  fi
fi

if [[ ! "$database_name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
  printf 'Error: refusing to reset unsafe database name %q.\n' "$database_name" >&2
  exit 1
fi

printf 'TaskNebula database reset\n'
printf 'This will permanently drop and recreate database: %s\n' "$database_name"
read -r -p "Type the database name to confirm: " confirmation
if [[ "$confirmation" != "$database_name" ]]; then
  printf 'Aborted.\n'
  exit 1
fi

use_compose='false'
if [[ -z "$database_url" || "$database_host" == 'postgres' ]] &&
  command -v docker >/dev/null 2>&1 &&
  docker compose version >/dev/null 2>&1 &&
  docker compose ps --status running --services 2>/dev/null | grep -qx postgres; then
  use_compose='true'
fi

if [[ "$use_compose" == 'true' ]]; then
  printf 'Resetting the Docker Compose PostgreSQL database...\n'
  docker compose exec -T postgres psql \
    -v ON_ERROR_STOP=1 \
    -U "$database_user" \
    -d postgres \
    -c "DROP DATABASE IF EXISTS \"$database_name\" WITH (FORCE);"
  docker compose exec -T postgres psql \
    -v ON_ERROR_STOP=1 \
    -U "$database_user" \
    -d postgres \
    -c "CREATE DATABASE \"$database_name\";"
else
  command -v dropdb >/dev/null 2>&1 || {
    printf 'Error: dropdb is required when the Compose database is not running.\n' >&2
    exit 1
  }
  command -v createdb >/dev/null 2>&1 || {
    printf 'Error: createdb is required when the Compose database is not running.\n' >&2
    exit 1
  }

  unset PGHOSTADDR PGSERVICE PGSERVICEFILE
  export PGHOST PGPORT PGUSER PGPASSWORD
  if [[ -n "$database_url" ]]; then
    PGHOST="$(DATABASE_URL="$database_url" node -e '
      process.stdout.write(new URL(process.env.DATABASE_URL).hostname);
    ')"
    PGPORT="$(DATABASE_URL="$database_url" node -e '
      process.stdout.write(new URL(process.env.DATABASE_URL).port || "5432");
    ')"
    PGUSER="$(DATABASE_URL="$database_url" node -e '
      process.stdout.write(decodeURIComponent(new URL(process.env.DATABASE_URL).username));
    ')"
    PGPASSWORD="$(DATABASE_URL="$database_url" node -e '
      process.stdout.write(decodeURIComponent(new URL(process.env.DATABASE_URL).password));
    ')"
    if [[ "$PGHOST" == 'postgres' ]]; then
      printf 'Error: Compose host "postgres" is unavailable outside the running Compose service.\n' >&2
      exit 1
    fi
  else
    PGHOST='127.0.0.1'
    PGPORT="$database_port"
    PGUSER="$database_user"
    PGPASSWORD="$database_password"
  fi

  printf 'Resetting PostgreSQL at %s:%s through explicit libpq configuration...\n' "$PGHOST" "$PGPORT"
  dropdb --host "$PGHOST" --port "$PGPORT" --username "$PGUSER" --if-exists --force "$database_name"
  createdb --host "$PGHOST" --port "$PGPORT" --username "$PGUSER" "$database_name"
fi

printf 'Running migrations...\n'
pnpm db:migrate
printf 'Database reset complete.\n'
