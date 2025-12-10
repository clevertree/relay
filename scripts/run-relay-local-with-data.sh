#!/usr/bin/env bash
set -euo pipefail

# Runs the local Docker container mapping host repos to /srv/relay/data
# Priority mount is /data (host). If unavailable, falls back to ./data in repo.

IMG_NAME="relay-all-in-one:local"
CNTR_NAME="relay-local"

# Determine host data dir
HOST_DATA_DEFAULT="/data"
HOST_DATA="${HOST_DATA:-$HOST_DATA_DEFAULT}"

if [ ! -d "$HOST_DATA" ] || [ ! -r "$HOST_DATA" ]; then
  echo "[run] Host data dir $HOST_DATA not accessible; falling back to ./data in repo"
  HOST_DATA="$(pwd)/data"
fi

mkdir -p "$HOST_DATA"

# Optional: ensure at least one bare repo exists for a quick test
if ! ls "$HOST_DATA"/*.git >/dev/null 2>&1; then
  echo "[run] No *.git bare repos found in $HOST_DATA"
  echo "[run] Creating example bare repo at $HOST_DATA/example.git (empty)"
  mkdir -p "$HOST_DATA/example.git"
  git init --bare "$HOST_DATA/example.git" >/dev/null
fi

echo "[run] Using host data dir: $HOST_DATA"

# Ensure image exists; build if missing
if ! docker image inspect "$IMG_NAME" >/dev/null 2>&1; then
  echo "[run] Image $IMG_NAME not found. Building..."
  docker build -t "$IMG_NAME" .
fi

echo "[run] Removing any existing container $CNTR_NAME"
docker rm -f "$CNTR_NAME" >/dev/null 2>&1 || true

echo "[run] Starting $CNTR_NAME from $IMG_NAME"
docker run -d --name "$CNTR_NAME" \
  -p 80:80 -p 443:443 -p 8080:8080 -p 8443:8443 \
  -e RELAY_HTTP_PORT=8080 -e RELAY_HTTPS_PORT=8443 \
  -e RELAY_ENABLE_IPFS=false -e RELAY_ENABLE_TORRENTS=false \
  -e RELAY_MASTER_REPO_LIST="" \
  -v "$HOST_DATA":/srv/relay/data \
  -v "$(pwd)/apps/client-web/dist":/srv/relay/www:ro \
  "$IMG_NAME"

echo "[run] Waiting for container to initialize..."
sleep 3

echo "[run] Mounts:"
docker inspect "$CNTR_NAME" --format '{{json .Mounts}}' | jq . || true

echo "[run] Container sees repos:"
docker exec "$CNTR_NAME" sh -lc 'ls -la /srv/relay/data; for d in /srv/relay/data/*.git; do [ -d "$d/objects" ] && echo ok: $d || echo bad: $d; done' || true

echo "[run] Test endpoints:"
set +e
curl -s -o /dev/null -w "GET /index.html -> %{http_code}\n" http://localhost:8080/index.html
curl -s -X OPTIONS -o /dev/null -w "OPTIONS / (non-preflight) -> %{http_code}\n" http://localhost:8080/
curl -s -X OPTIONS -H "Origin: https://example.com" -H "Access-Control-Request-Method: GET" -o /dev/null -w "OPTIONS / (preflight) -> %{http_code}\n" http://localhost:8080/
set -e

echo "[run] Done. Visit http://localhost:8080/index.html"
