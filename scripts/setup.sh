#!/usr/bin/env bash

# TaskNebula local development setup.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

info() { printf '==> %s\n' "$*"; }
ok() { printf '✓ %s\n' "$*"; }
warn() { printf '! %s\n' "$*"; }
die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

env_value() {
  local file="$1"
  local key="$2"

  awk -v key="$key" '
    index($0, key "=") == 1 { value = substr($0, length(key) + 2) }
    END { print value }
  ' "$file"
}

set_env_value() {
  local file="$1"
  local key="$2"
  local value="$3"
  local temporary
  local found='false'
  local line

  temporary="$(mktemp "${file}.tmp.XXXXXX")"
  chmod 600 "$temporary"
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" == "$key="* ]]; then
      if [[ "$found" == 'false' ]]; then
        printf '%s=%s\n' "$key" "$value" >>"$temporary"
        found='true'
      fi
    else
      printf '%s\n' "$line" >>"$temporary"
    fi
  done <"$file"
  if [[ "$found" == 'false' ]]; then
    printf '%s=%s\n' "$key" "$value" >>"$temporary"
  fi
  mv "$temporary" "$file"
}

info 'Checking Node.js and pnpm'
command -v node >/dev/null 2>&1 || die 'Node.js 22 or newer is required.'
node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
if ((node_major < 22)); then
  die "Node.js 22 or newer is required; found $(node -v)."
fi

if ! command -v pnpm >/dev/null 2>&1; then
  command -v corepack >/dev/null 2>&1 ||
    die 'pnpm is missing and Corepack is unavailable. Install pnpm 9 or newer, then rerun.'
  package_manager="$(node -p 'require("./package.json").packageManager')"
  info "Activating ${package_manager} with Corepack"
  corepack enable
  corepack prepare "$package_manager" --activate
fi

pnpm_major="$(pnpm --version | cut -d. -f1)"
if ((pnpm_major < 9)); then
  die "pnpm 9 or newer is required; found $(pnpm --version)."
fi
ok "Using Node $(node -v) and pnpm $(pnpm --version)"

info 'Installing dependencies'
pnpm install

info 'Provisioning local environment files'
if [[ ! -f .env ]]; then
  cp .env.example .env
  ok 'Created .env from .env.example'
else
  warn '.env already exists; preserving its current values.'
fi

if [[ ! -f apps/web/.env.local ]]; then
  cp apps/web/.env.example apps/web/.env.local
  ok 'Created apps/web/.env.local from apps/web/.env.example'
else
  warn 'apps/web/.env.local already exists; preserving its current values.'
fi
chmod 600 .env apps/web/.env.local

auth_secret="$(env_value .env AUTH_SECRET)"
postgres_password="$(env_value .env POSTGRES_PASSWORD)"
redis_password="$(env_value .env REDIS_PASSWORD)"
livekit_api_key="$(env_value .env LIVEKIT_API_KEY)"
livekit_api_secret="$(env_value .env LIVEKIT_API_SECRET)"
cron_secret="$(env_value .env CRON_SECRET)"
if [[ -z "$auth_secret" || -z "$postgres_password" || "$postgres_password" == 'postgres' || \
  -z "$redis_password" || -z "$livekit_api_key" || "$livekit_api_key" == 'tasknebula-dev' || \
  -z "$livekit_api_secret" || "$livekit_api_secret" == 'tasknebula-livekit-secret-local-2026' || \
  -z "$cron_secret" ]]; then
  command -v openssl >/dev/null 2>&1 ||
    die 'openssl is required to generate local service credentials.'
fi

if [[ -z "$auth_secret" ]]; then
  auth_secret="$(openssl rand -base64 32)"
  set_env_value .env AUTH_SECRET "$auth_secret"
  ok 'Generated AUTH_SECRET in .env'
fi

if [[ -z "$redis_password" ]]; then
  redis_password="$(openssl rand -hex 32)"
  set_env_value .env REDIS_PASSWORD "$redis_password"
  ok 'Generated REDIS_PASSWORD in .env'
fi

if [[ -z "$postgres_password" || "$postgres_password" == 'postgres' ]]; then
  postgres_password="$(openssl rand -hex 32)"
  set_env_value .env POSTGRES_PASSWORD "$postgres_password"
  ok 'Generated POSTGRES_PASSWORD in .env'
fi

if [[ -z "$livekit_api_key" || "$livekit_api_key" == 'tasknebula-dev' ]]; then
  livekit_api_key="$(openssl rand -hex 16)"
  set_env_value .env LIVEKIT_API_KEY "$livekit_api_key"
  ok 'Generated LIVEKIT_API_KEY in .env'
fi

if [[ -z "$livekit_api_secret" || "$livekit_api_secret" == 'tasknebula-livekit-secret-local-2026' ]]; then
  livekit_api_secret="$(openssl rand -hex 32)"
  set_env_value .env LIVEKIT_API_SECRET "$livekit_api_secret"
  ok 'Generated LIVEKIT_API_SECRET in .env'
fi

if [[ -z "$cron_secret" ]]; then
  cron_secret="$(openssl rand -hex 32)"
  set_env_value .env CRON_SECRET "$cron_secret"
  ok 'Generated CRON_SECRET in .env'
fi

web_secret="$(env_value apps/web/.env.local NEXTAUTH_SECRET)"
if [[ -z "$web_secret" || "$web_secret" == 'your-secret-key-here' ]]; then
  set_env_value apps/web/.env.local NEXTAUTH_SECRET "$auth_secret"
  ok 'Generated the local web auth secret'
fi

web_database_url="$(env_value apps/web/.env.local DATABASE_URL)"
if [[ -z "$web_database_url" || "$web_database_url" == 'postgresql://postgres:postgres@localhost:5432/tasknebula' ]]; then
  postgres_user="$(env_value .env POSTGRES_USER)"
  postgres_database="$(env_value .env POSTGRES_DB)"
  postgres_port="$(env_value .env DB_PORT)"
  postgres_user="${postgres_user:-postgres}"
  postgres_database="${postgres_database:-tasknebula}"
  postgres_port="${postgres_port:-5432}"
  encoded_postgres_user="$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$postgres_user")"
  encoded_postgres_password="$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$postgres_password")"
  encoded_postgres_database="$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$postgres_database")"
  set_env_value apps/web/.env.local DATABASE_URL \
    "postgresql://${encoded_postgres_user}:${encoded_postgres_password}@localhost:${postgres_port}/${encoded_postgres_database}"
  ok 'Configured the local web database URL'
fi

if command -v docker >/dev/null 2>&1; then
  reply='n'
  if [[ -t 0 ]]; then
    read -r -p 'Start PostgreSQL and Redis with Docker Compose? (y/N) ' reply || true
  fi
  if [[ "$reply" =~ ^[Yy]$ ]]; then
    docker compose version >/dev/null 2>&1 ||
      die 'Docker Compose v2 is required (the `docker compose` plugin).'
    info 'Starting PostgreSQL and Redis'
    docker compose up -d --wait postgres redis
    ok 'PostgreSQL and Redis are healthy'
  fi
else
  warn 'Docker is unavailable; configure PostgreSQL manually before migrating.'
fi

reply='n'
if [[ -t 0 ]]; then
  read -r -p 'Run database migrations now? (y/N) ' reply || true
fi
if [[ "$reply" =~ ^[Yy]$ ]]; then
  info 'Running database migrations'
  pnpm db:migrate
  ok 'Database migrations completed'
fi

printf '\nSetup complete. Start the web app with:\n'
printf '  pnpm --filter @tasknebula/web dev\n\n'
printf 'Optional collaboration setup: services/hocuspocus/README.md\n'
