#!/usr/bin/env bash
# Deploy xPenditur to the home server.
#
# Pushes local main to origin, then on the server: backs up data/, fast-forwards
# /opt/xpenditur to origin/main, rebuilds the image and restarts the container,
# and checks the app answers over HTTP.
#
# Usage: scripts/deploy.sh            (from Git Bash / any POSIX shell)
# Env overrides: DEPLOY_HOST, DEPLOY_DIR, DEPLOY_BRANCH, DEPLOY_PORT
set -euo pipefail

HOST="${DEPLOY_HOST:-192.168.0.23}"     # SSH alias; user/port come from ~/.ssh/config
DIR="${DEPLOY_DIR:-/opt/xpenditur}"
BRANCH="${DEPLOY_BRANCH:-main}"
PORT="${DEPLOY_PORT:-3000}"

cd "$(dirname "$0")/.."

if [ -n "$(git status --porcelain)" ]; then
  echo "error: working tree has uncommitted changes; commit them first." >&2
  exit 1
fi

current="$(git rev-parse --abbrev-ref HEAD)"
if [ "$current" != "$BRANCH" ]; then
  echo "error: on branch '$current'; deploys go from '$BRANCH'." >&2
  exit 1
fi

echo "==> Pushing $BRANCH to origin"
git push origin "$BRANCH"
rev="$(git rev-parse --short HEAD)"

echo "==> Deploying $rev to $HOST:$DIR"
ssh "$HOST" bash -s -- "$DIR" "$BRANCH" "$PORT" "$rev" <<'REMOTE'
set -euo pipefail
DIR="$1"; BRANCH="$2"; PORT="$3"; REV="$4"
cd "$DIR"

echo "--> Backing up data/"
mkdir -p backups
tar -czf "backups/data-$(date +%Y%m%d-%H%M%S).tgz" data
ls -1t backups/data-*.tgz | tail -n +11 | xargs -r rm -f   # keep last 10

echo "--> Updating code"
git fetch --quiet origin "$BRANCH"
git checkout --quiet "$BRANCH"
git merge --ff-only "origin/$BRANCH"
deployed="$(git rev-parse --short HEAD)"
if [ "$deployed" != "$REV" ]; then
  echo "error: server is at $deployed, expected $REV" >&2
  exit 1
fi

echo "--> Rebuilding and restarting"
docker compose up -d --build
docker image prune -f >/dev/null

echo "--> Waiting for the app on :$PORT"
for i in $(seq 1 30); do
  if curl -fsS -o /dev/null "http://localhost:$PORT/"; then
    echo "--> Up at $deployed"
    exit 0
  fi
  sleep 2
done
echo "error: app did not respond within 60s; recent logs:" >&2
docker compose logs --tail 50 >&2
exit 1
REMOTE

echo "==> Deployed $rev"
