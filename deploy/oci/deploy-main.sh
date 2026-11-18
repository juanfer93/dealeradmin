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
  confirmed=$(curl --silent --show-error --fail --connect-timeout 8 --max-time 20 \
    https://dealeradmin.163-192-138-175.sslip.io/api/deployment/commit || true)
  if [[ "$confirmed" == "$target" ]]; then
    exit 0
  fi
fi

deploy_env_file=$(mktemp)
trap 'rm -f "$deploy_env_file"' EXIT
printf 'DEALERADMIN_GIT_SHA=%s\n' "$target" > "$deploy_env_file"
sudo -n docker compose --env-file .env.oci --env-file "$deploy_env_file" -f docker-compose.oci.yml up -d --build
status=000
for attempt in $(seq 1 24); do
  status=$(curl --silent --output /dev/null --write-out '%{http_code}' \
    --connect-timeout 8 --max-time 30 https://dealeradmin.163-192-138-175.sslip.io/ || true)
  [[ "$status" =~ ^2[0-9][0-9]$ ]] && break
  sleep 5
done
[[ "$status" =~ ^2[0-9][0-9]$ ]] || { echo "Web check failed: HTTP $status" >&2; exit 1; }
confirmed=''
for attempt in $(seq 1 24); do
  confirmed=$(curl --silent --show-error --fail --connect-timeout 8 --max-time 20 \
    https://dealeradmin.163-192-138-175.sslip.io/api/deployment/commit || true)
  [[ "$confirmed" == "$target" ]] && break
  sleep 5
done
[[ "$confirmed" == "$target" ]] || { echo "Deployment commit mismatch: expected $target, received ${confirmed:-no confirmation}" >&2; exit 1; }
printf '%s\n' "$target" > "$state_file.tmp"
mv "$state_file.tmp" "$state_file"
printf 'Deployed main at %s\n' "$target"
