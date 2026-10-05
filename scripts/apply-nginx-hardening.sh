#!/usr/bin/env bash
# ValidTeam nginx hardening applier — run once with sudo
# Usage:  sudo bash scripts/apply-nginx-hardening.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ $EUID -ne 0 ]]; then
  echo "must run as root" >&2
  exit 1
fi

install -m 0644 "$REPO_ROOT/nginx/validteam-hardening.conf" /etc/nginx/conf.d/validteam-hardening.conf
install -m 0644 "$REPO_ROOT/nginx/validteam.conf" /etc/nginx/sites-available/validteam
ln -sfn /etc/nginx/sites-available/validteam /etc/nginx/sites-enabled/validteam

nginx -t
nginx -s reload

echo "✅ Hardening applied. Rate limits + scanner blocks + TLS tuning + CSP + HSTS active."
