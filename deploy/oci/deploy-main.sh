#!/usr/bin/env bash
set -euo pipefail

repo=/home/opc/dealeradmin
state_file=/home/opc/.dealeradmin-deployed-sha

exec 9>/tmp/dealeradmin-main-deploy.lock
flock -n 9 || exit 0

cd "$repo"
git fetch --quiet origin main
target=$(git rev-parse origin/main)
current=$(git rev-parse HEAD)
deployed=$(cat "$state_file" 2>/dev/null || true)

if [[ "$current" != "$target" ]]; then
  git merge --ff-only --quiet origin/main
fi

if [[ "$deployed" == "$target" ]]; then
  exit 0
fi

sudo -n docker compose --env-file .env.oci -f docker-compose.oci.yml up -d --build
status=000
for attempt in $(seq 1 24); do
  status=$(curl --silent --output /dev/null --write-out '%{http_code}' \
    --connect-timeout 8 --max-time 30 https://dealeradmin.163-192-138-175.sslip.io/ || true)
  [[ "$status" =~ ^2[0-9][0-9]$ ]] && break
  sleep 5
done
[[ "$status" =~ ^2[0-9][0-9]$ ]] || { echo "Web check failed: HTTP $status" >&2; exit 1; }
printf '%s\n' "$target" > "$state_file.tmp"
mv "$state_file.tmp" "$state_file"
printf 'Deployed main at %s\n' "$target"
