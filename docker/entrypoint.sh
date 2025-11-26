#!/bin/sh
# Minimal entrypoint for Relay all-in-one image.
# Starts IPFS, Deluge, ensures a bare repo exists, runs git-daemon, then execs relay-server.

set -e

ensure_repo() {
  repo=${RELAY_REPO_PATH:-/srv/relay/data/repo.git}
  if [ ! -d "$repo" ] || [ ! -d "$repo/objects" ]; then
    tmpl=${RELAY_TEMPLATE_URL:-https://github.com/clevertree/relay-template}
    echo "Cloning bare repo from $tmpl to $repo"
    mkdir -p "$(dirname "$repo")"
    git clone --bare "$tmpl" "$repo"
  fi
}

start_ipfs() {
  IPFS_PATH=/srv/relay/ipfs
  if ! ipfs --repo "$IPFS_PATH" repo stat >/dev/null 2>&1; then
    IPFS_PATH="$IPFS_PATH" ipfs init
  fi
  IPFS_PATH="$IPFS_PATH" ipfs daemon &
}

start_deluged() {
  deluged -d -c /var/lib/deluge || true
}

start_git_daemon() {
  git daemon --reuseaddr --base-path=/srv/relay/data --export-all --enable=receive-pack --informative-errors --verbose --detach --listen=0.0.0.0 --port=9418 || true
}

main() {
  start_ipfs
  start_deluged
  ensure_repo
  start_git_daemon

  export RELAY_REPO_PATH=${RELAY_REPO_PATH:-/srv/relay/data/repo.git}
  # Allocate an ephemeral port if RELAY_BIND not explicitly provided.
  # If RELAY_BIND is provided in the form host:port and port is non-zero, we'll use it.
  if [ -n "${RELAY_BIND:-}" ]; then
    # Use provided bind
    export RELAY_BIND=${RELAY_BIND}
  else
    # Use a tiny Python one-liner to bind to port 0 and print the assigned port.
    # This ensures the host (or container) can actually open a listening port (firewall/NAT checks).
    PY_OUT=$(python3 - <<'PY'
import socket, sys
try:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind(("0.0.0.0", 0))
    port = s.getsockname()[1]
    print(port)
    s.close()
except Exception as e:
    print('ERR:'+str(e), file=sys.stderr)
    sys.exit(2)
PY
)
    if [ $? -ne 0 ]; then
      echo "Failed to allocate ephemeral port for RELAY_BIND"
      exit 1
    fi
    if echo "$PY_OUT" | grep -q '^ERR:'; then
      echo "Ephemeral port allocation error: $PY_OUT"
      exit 1
    fi
    EPHEMERAL_PORT=$(echo "$PY_OUT" | tr -d '\n' | tr -d '\r')
    if ! echo "$EPHEMERAL_PORT" | grep -qE '^[0-9]+$'; then
      echo "Invalid ephemeral port: $EPHEMERAL_PORT"
      exit 1
    fi
    export RELAY_BIND="0.0.0.0:${EPHEMERAL_PORT}"
    echo "Allocated ephemeral port ${EPHEMERAL_PORT} and set RELAY_BIND=${RELAY_BIND}"
  fi

  # Start the relay server in background so we can perform post-start tasks (peer upsert)
  echo "Starting relay-server with RELAY_BIND=${RELAY_BIND}"
  /usr/local/bin/relay-server &
  RELAY_PID=$!

  # Determine socket URL (was previously advertised to tracker; tracker removed)
  if [ -n "${RELAY_SOCKET_URL:-}" ]; then
    SOCKET_URL=${RELAY_SOCKET_URL}
  else
    # If RELAY_PUBLIC_HOST is set, use it; else use the DNS name if set; else default to localhost
    if [ -n "${RELAY_PUBLIC_HOST:-}" ]; then
      HOSTNAME_FOR_ADVERTISE=${RELAY_PUBLIC_HOST}
    elif [ -n "${RELAY_DNS_SUBDOMAIN:-}" ]; then
      HOSTNAME_FOR_ADVERTISE="${RELAY_DNS_SUBDOMAIN}.${RELAY_DNS_DOMAIN:-relaynet.online}"
    else
      HOSTNAME_FOR_ADVERTISE="localhost"
    fi
    # Extract port from RELAY_BIND
    PORT_FOR_ADVERTISE=$(echo "$RELAY_BIND" | awk -F: '{print $NF}')
    SOCKET_URL="http://${HOSTNAME_FOR_ADVERTISE}:${PORT_FOR_ADVERTISE}"
    export RELAY_SOCKET_URL=${SOCKET_URL}
  fi

  echo "Advertising socket URL: ${RELAY_SOCKET_URL}"

  # Tracker removed; skipping peer upsert

  # --- Vercel DNS registration (requires VERCEL_API_TOKEN) ---
  VERCEL_API_TOKEN_ENV=${VERCEL_API_TOKEN:-}
  VERCEL_DOMAIN=${RELAY_DNS_DOMAIN:-relaynet.online}
  VERCEL_SUBDOMAIN=${RELAY_DNS_SUBDOMAIN:-node1}
  FQDN="${VERCEL_SUBDOMAIN}.${VERCEL_DOMAIN}"

  get_public_ip() {
    # Try multiple services to determine public IPv4
    for url in \
      "https://api.ipify.org" \
      "https://ipv4.icanhazip.com" \
      "https://ifconfig.me/ip"; do
      ip=$(curl -fsS "$url" | tr -d '\r' | tr -d '\n' || true)
      if echo "$ip" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then
        echo "$ip"
        return 0
      fi
    done
    return 1
  }

  vercel_dns_upsert() {
    domain="$1"; name="$2"; value="$3"; type="${4:-A}"; ttl="${5:-60}"
    auth_header="Authorization: Bearer ${VERCEL_API_TOKEN_ENV}"
    base="https://api.vercel.com";
    # List existing records matching name+type
    list_url="${base}/v5/domains/${domain}/records?name=${name}&type=${type}"
    list_res=$(curl -fsS -H "$auth_header" "$list_url" || true)
    rec_id=$(echo "$list_res" | jq -r '.records[0].id // .records[0].uid // empty')
    if [ -n "$rec_id" ]; then
      # Update existing
      patch_url="${base}/v5/domains/${domain}/records/${rec_id}"
      body=$(jq -n --arg v "$value" --argjson t $ttl '{ value: $v, ttl: $t }')
      curl -fsS -X PATCH -H "$auth_header" -H 'Content-Type: application/json' -d "$body" "$patch_url" >/dev/null
    else
      # Create new
      create_url="${base}/v5/domains/${domain}/records"
      body=$(jq -n --arg n "$name" --arg v "$value" --arg t "$type" --argjson ttl $ttl '{ name: $n, value: $v, type: $t, ttl: $ttl }')
      curl -fsS -X POST -H "$auth_header" -H 'Content-Type: application/json' -d "$body" "$create_url" >/dev/null
    fi
  }

  if [ -n "$VERCEL_API_TOKEN_ENV" ]; then
    echo "Attempting Vercel DNS upsert for ${FQDN}"
    # Determine public IP
    PUB_IP=""
    for i in 1 2 3 4 5; do
      PUB_IP=$(get_public_ip || true)
      if [ -n "$PUB_IP" ]; then break; fi
      echo "Failed to determine public IP (attempt $i); retrying..."
      sleep 3
    done
    if [ -z "$PUB_IP" ]; then
      echo "Could not determine public IP; stopping relay-server and exiting"
      kill ${RELAY_PID} || true
      exit 1
    fi

    # Upsert A record with retries
    DNS_OK="no"
    for i in 1 2 3 4 5; do
      if vercel_dns_upsert "$VERCEL_DOMAIN" "$VERCEL_SUBDOMAIN" "$PUB_IP" "A" 60; then
        echo "DNS upsert succeeded (attempt $i) for ${FQDN} -> ${PUB_IP}"
        DNS_OK="yes"; break
      else
        echo "DNS upsert failed (attempt $i); retrying..."
        sleep 5
      fi
    done
    if [ "$DNS_OK" != "yes" ]; then
      echo "DNS upsert failed after retries; stopping relay-server and exiting"
      kill ${RELAY_PID} || true
      exit 1
    fi
  else
    echo "VERCEL_API_TOKEN not set; skipping DNS upsert"
  fi

  # --- SSL certificate via certbot (nginx) ---
  if [ -n "${RELAY_CERTBOT_EMAIL:-}" ]; then
    echo "Requesting SSL certificate for ${FQDN} via certbot"
    CERT_OK="no"
    for i in 1 2 3; do
      if certbot --nginx -d "$FQDN" -m "$RELAY_CERTBOT_EMAIL" --agree-tos --non-interactive ${RELAY_CERTBOT_STAGING:+--staging}; then
        CERT_OK="yes"; break
      else
        echo "Certbot failed (attempt $i); retrying..."
        sleep 10
      fi
    done
    if [ "$CERT_OK" != "yes" ]; then
      echo "Certbot failed after retries; stopping relay-server and exiting"
      kill ${RELAY_PID} || true
      exit 1
    fi
    # Reload nginx to pick up new certs
    nginx -s reload || true
  else
    echo "RELAY_CERTBOT_EMAIL not set; skipping SSL certificate provisioning"
  fi

  # Wait for relay-server to exit (foreground)
  wait ${RELAY_PID}
}

main "$@"

