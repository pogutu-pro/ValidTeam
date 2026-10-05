#!/usr/bin/env bash
# ValidTeam one-command quickstart.
# Pipe from curl: curl -fsSL <url> | bash
# Or run locally after cloning: ./scripts/quickstart.sh
set -euo pipefail

BLUE='\033[0;34m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()  { printf "%b==>%b %s\n" "$BLUE" "$NC" "$*"; }
ok()   { printf "%b✓%b %s\n"  "$GREEN" "$NC" "$*"; }
warn() { printf "%b!%b %s\n"  "$YELLOW" "$NC" "$*"; }
die()  { printf "%b✗%b %s\n"  "$RED"   "$NC" "$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die "Docker is required. Install: https://docs.docker.com/get-docker/"
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required (docker compose plugin)."
command -v openssl >/dev/null 2>&1 || die "openssl is required to generate service credentials."

TARGET_DIR="${VALIDTEAM_DIR:-$PWD/validteam}"

set_env_var() {
  local key="$1"
  local value="$2"
  local temporary
  local found='false'
  local line

  temporary="$(mktemp .env.tmp.XXXXXX)"
  chmod 600 "$temporary"
  while IFS= read -r line || [ -n "$line" ]; do
    if [[ "$line" == "$key="* ]]; then
      if [[ "$found" == 'false' ]]; then
        printf '%s=%s\n' "$key" "$value" >>"$temporary"
        found='true'
      fi
    else
      printf '%s\n' "$line" >>"$temporary"
    fi
  done <.env
  if [[ "$found" == 'false' ]]; then
    printf '%s=%s\n' "$key" "$value" >>"$temporary"
  fi
  mv "$temporary" .env
}

env_value() {
  grep "^$1=" .env | tail -n 1 | cut -d= -f2- || true
}

if [ ! -d "$TARGET_DIR/.git" ]; then
  log "Cloning ValidTeam into $TARGET_DIR ..."
  command -v git >/dev/null 2>&1 || die "git is required for the first install."
  git clone --depth 1 https://github.com/neuraparse/validteam.git "$TARGET_DIR"
else
  log "Updating existing checkout in $TARGET_DIR ..."
  git -C "$TARGET_DIR" pull --ff-only
fi

cd "$TARGET_DIR"

if [ ! -f .env ]; then
  log "Provisioning .env from .env.example ..."
  cp .env.example .env
else
  warn ".env already exists — leaving it as-is."
fi
chmod 600 .env

if [ -z "$(env_value AUTH_SECRET)" ]; then
  set_env_var "AUTH_SECRET" "$(openssl rand -base64 32)"
  ok "Generated AUTH_SECRET (32-byte base64)."
fi

if [ -z "$(env_value REDIS_PASSWORD)" ]; then
  set_env_var "REDIS_PASSWORD" "$(openssl rand -hex 32)"
  ok "Generated REDIS_PASSWORD (32-byte hex)."
fi

postgres_password="$(env_value POSTGRES_PASSWORD)"
if [ -z "$postgres_password" ] || [ "$postgres_password" = 'postgres' ]; then
  set_env_var "POSTGRES_PASSWORD" "$(openssl rand -hex 32)"
  ok "Generated POSTGRES_PASSWORD (32-byte hex)."
fi

livekit_api_key="$(env_value LIVEKIT_API_KEY)"
if [ -z "$livekit_api_key" ] || [ "$livekit_api_key" = 'validteam-dev' ]; then
  set_env_var "LIVEKIT_API_KEY" "$(openssl rand -hex 16)"
  ok "Generated optional LIVEKIT_API_KEY."
fi

livekit_api_secret="$(env_value LIVEKIT_API_SECRET)"
if [ -z "$livekit_api_secret" ] || [ "$livekit_api_secret" = 'validteam-livekit-secret-local-2026' ]; then
  set_env_var "LIVEKIT_API_SECRET" "$(openssl rand -hex 32)"
  ok "Generated optional LIVEKIT_API_SECRET."
fi

if [ -z "$(env_value CRON_SECRET)" ]; then
  set_env_var "CRON_SECRET" "$(openssl rand -hex 32)"
  ok "Generated CRON_SECRET for the approval reconciler."
fi

log "Pulling latest published image: neuraparse/validteam:latest ..."
docker compose pull web || warn "Image pull failed — will fall back to local build."

log "Starting services (postgres · redis · web · approval reconciler) ..."
docker compose up -d --wait

log "Waiting for the web container to report healthy ..."
DEADLINE=$(( $(date +%s) + 180 ))
while :; do
  STATUS="$(docker inspect -f '{{.State.Health.Status}}' validteam-web 2>/dev/null || true)"
  [ "$STATUS" = "healthy" ] && break
  [ "$(date +%s)" -ge "$DEADLINE" ] && die "Container did not become healthy within 180s. Run 'docker compose logs web' to inspect."
  sleep 3
done

ok "ValidTeam is running at http://localhost:3000"
printf "\n"
printf "  First-time setup wizard will guide admin-account creation.\n"
printf "  Logs:    docker compose logs -f web\n"
printf "  Stop:    docker compose down\n"
printf "  Update:  docker compose pull && docker compose up -d\n\n"
printf "  Voice:   configure LIVEKIT_URL/NEXT_PUBLIC_LIVEKIT_URL, then docker compose --profile voice up -d\n\n"
