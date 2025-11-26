
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

  # If DNS vars are present, attempt to upsert via tracker DNS API before starting
  if [ -n "${RELAY_DNS_SUBDOMAIN:-}" ]; then
    DNS_DOMAIN=${RELAY_DNS_DOMAIN:-relaynet.online}
    DNS_URL=${TRACKER_DNS_URL:-https://relaynet.online/api/dns/upsert}
    # Get external IPv4
    EXTERNAL_IPV4=$(curl -s https://api.ipify.org?format=json | jq -r .ip 2>/dev/null || echo "")
    PAYLOAD=$(jq -n --arg name "$RELAY_DNS_SUBDOMAIN" --arg domain "$DNS_DOMAIN" --arg ipv4 "$EXTERNAL_IPV4" '{name: $name, domain: $domain, ipv4: $ipv4}')
    echo "Requesting DNS upsert to $DNS_URL with payload: $PAYLOAD"
    # If TRACKER_ADMIN_TOKEN is set, include it
    if [ -n "${TRACKER_ADMIN_TOKEN:-}" ]; then
      AUTH_HEADER="Authorization: Bearer ${TRACKER_ADMIN_TOKEN}"
    else
      AUTH_HEADER=""
    fi
    if [ -n "$AUTH_HEADER" ]; then
      RES=$(curl -s -o /tmp/dns_res -w "%{http_code}" -X POST -H "Content-Type: application/json" -H "$AUTH_HEADER" -d "$PAYLOAD" "$DNS_URL")
    else
      RES=$(curl -s -o /tmp/dns_res -w "%{http_code}" -X POST -H "Content-Type: application/json" -d "$PAYLOAD" "$DNS_URL")
    fi
    if [ "$RES" -lt 200 ] || [ "$RES" -ge 300 ]; then
      echo "DNS upsert failed (status=$RES), response:" && cat /tmp/dns_res
      echo "Exiting container due to DNS upsert failure"
      exit 1
    fi
    echo "DNS upsert succeeded: " && cat /tmp/dns_res

    # Write a minimal nginx site config to proxy the subdomain to the relay server
    SERVER_NAME="${RELAY_DNS_SUBDOMAIN}.${DNS_DOMAIN}"
    cat > /etc/nginx/sites-available/relay <<EOF
server {
    listen 80;
    server_name ${SERVER_NAME};

    location / {
        proxy_pass http://127.0.0.1:8088;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
EOF
    ln -sf /etc/nginx/sites-available/relay /etc/nginx/sites-enabled/relay || true
    # Start nginx so certbot can talk to it
    nginx

    # If CERTBOT_EMAIL is set, try to obtain certs via certbot --nginx
    if [ -n "${CERTBOT_EMAIL:-}" ]; then
      # Optionally use staging to avoid rate limits
      STAGING_FLAG=""
      if [ "${CERTBOT_STAGING:-}" = "1" ] || [ "${CERTBOT_STAGING:-}" = "true" ]; then
        STAGING_FLAG="--staging"
      fi
      echo "Requesting TLS certificate for ${SERVER_NAME} via certbot"
      if ! certbot --nginx $STAGING_FLAG --non-interactive --agree-tos --email "$CERTBOT_EMAIL" -d "$SERVER_NAME"; then
        echo "certbot failed"
        nginx -s stop || true
        echo "Exiting container due to certbot failure"
        exit 1
      fi
      echo "certbot succeeded"
    fi
  fi

  # Start the relay server in background so we can perform post-start tasks (peer upsert)
  echo "Starting relay-server with RELAY_BIND=${RELAY_BIND}"
  /usr/local/bin/relay-server &
  RELAY_PID=$!

  # Determine socket URL to advertise to tracker for peer upsert. Prefer RELAY_SOCKET_URL env if set,
  # otherwise construct from detected host/name and allocated port.
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

  # Peer upsert: call tracker API to register this node's socket and repos
  if [ -n "${TRACKER_DNS_URL:-}" ] || [ -n "${RELAY_TRACKER_URL:-}" ]; then
    # Prefer explicit TRACKER_DNS_URL for peer upsert endpoint; fallback to RELAY_TRACKER_URL + /api/peers/upsert
    if [ -n "${RELAY_TRACKER_URL:-}" ]; then
      PEERS_URL="${RELAY_TRACKER_URL%/}/api/peers/upsert"
    else
      PEERS_URL="${TRACKER_DNS_URL%/}/peers/upsert"
    fi
    # Build payload: socket and optionally domain or ipv4/ipv6
    # Prefer domain when RELAY_DNS_SUBDOMAIN is set
    PAYLOAD_PEER=$(jq -n \
      --arg socket "${RELAY_SOCKET_URL}" \
      --arg domain "${RELAY_DNS_SUBDOMAIN:-}" \
      --arg dns_domain "${RELAY_DNS_DOMAIN:-}" \
      --arg ipv4 "${RELAY_PUBLIC_IPV4:-}" \
      --arg ipv6 "${RELAY_PUBLIC_IPV6:-}" \
      --argjson repos '[]' \
      '($domain // "") as $d | ($dns_domain // "") as $dd | \n+       ($d | length) as $hasDomain | \n+       if $hasDomain > 0 then {socket: $socket, domain: ($d + (if $dd|length>0 then ("." + $dd) else "" end)), repos: $repos} \n+       else {socket: $socket, ipv4: ($ipv4 // null), ipv6: ($ipv6 // null), repos: $repos} end')
    echo "Posting peer upsert to ${PEERS_URL} with payload: ${PAYLOAD_PEER}"
    if [ -n "${TRACKER_ADMIN_TOKEN:-}" ]; then
      RES_PEER=$(curl -s -o /tmp/peer_res -w "%{http_code}" -X POST -H "Content-Type: application/json" -H "Authorization: Bearer ${TRACKER_ADMIN_TOKEN}" -d "${PAYLOAD_PEER}" "${PEERS_URL}")
    else
      RES_PEER=$(curl -s -o /tmp/peer_res -w "%{http_code}" -X POST -H "Content-Type: application/json" -d "${PAYLOAD_PEER}" "${PEERS_URL}")
    fi
    if [ -z "${RES_PEER:-}" ] || [ "$RES_PEER" -lt 200 ] || [ "$RES_PEER" -ge 300 ]; then
      echo "Peer upsert failed (status=$RES_PEER), response:" && cat /tmp/peer_res || true
      echo "Killing relay-server (pid=${RELAY_PID}) and exiting"
      kill ${RELAY_PID} || true
      exit 1
    fi
    echo "Peer upsert succeeded: " && cat /tmp/peer_res
  else
    echo "No tracker URL configured; skipping peer upsert"
  fi

  # Wait for relay-server to exit (foreground)
  wait ${RELAY_PID}
}

main "$@"

