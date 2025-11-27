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
  # Ensure at least one repository exists by cloning template into a subdirectory if needed
  template_repo_dir="$repo/relay-template"
  if [ ! -d "$template_repo_dir" ]; then
    tmpl=${RELAY_TEMPLATE_URL:-https://github.com/clevertree/relay-template}
    echo "Cloning template repo into subdirectory $template_repo_dir"
    mkdir -p "$template_repo_dir"
    git clone "$tmpl" "$template_repo_dir"
    # Add and commit the subdirectory to the bare repo
    cd "$repo"
    git --git-dir="$repo" --work-tree="$template_repo_dir" add .
    git --git-dir="$repo" --work-tree="$template_repo_dir" commit -m "Add relay-template repository"
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
    base="https://api.vercel.com"
    # prefer v4 endpoints and include teamId when present
    team_q=""
    if [ -n "${VERCEL_TEAM_ID:-}" ]; then
      team_q="?teamId=${VERCEL_TEAM_ID}"
    fi

    # Helper to exit on auth errors
    handle_auth_err() {
      status="$1"; body="$2"
      if echo "$body" | grep -qi 'forbidden' || [ "$status" = "401" ] || [ "$status" = "403" ]; then
        echo "Vercel auth error (status=$status): $body"
        return 2
      fi
      return 0
    }

    # List existing records via v4
    list_url="${base}/v4/domains/${domain}/records${team_q}&name=${name}&type=${type}"
    list_raw=$(curl -sS -w "\n%{http_code}" -H "$auth_header" "$list_url" || true)
    list_body=$(echo "$list_raw" | sed -n '1,$p' | sed '$d') || list_body=""
    list_code=$(echo "$list_raw" | tail -n1 || echo "")
    if [ -z "$list_code" ]; then list_code=0; fi
    if [ "$list_code" = "200" ]; then
      rec_id=$(echo "$list_body" | jq -r '.records[] | select(.name=="'"$name"'" and .type=="'"$type"'" ) | .id // .uid' | head -n1 || true)
    else
      handle_auth_err "$list_code" "$list_body" || return 2
      rec_id=""
    fi

    # If record exists in v4, PATCH via v4
    if [ -n "$rec_id" ]; then
      patch_url="${base}/v4/domains/${domain}/records/${rec_id}${team_q}"
      body=$(jq -n --arg v "$value" --argjson t $ttl '{ value: $v, ttl: $t }')
      res=$(curl -sS -w "\n%{http_code}" -X PATCH -H "$auth_header" -H 'Content-Type: application/json' -d "$body" "$patch_url" || true)
      res_body=$(echo "$res" | sed -n '1,$p' | sed '$d' || true)
      res_code=$(echo "$res" | tail -n1 || echo "")
      if [ "$res_code" = "200" ] || [ "$res_code" = "204" ]; then
        return 0
      else
        handle_auth_err "$res_code" "$res_body" || return 2
        # if not auth error, treat as failure
        return 1
      fi
    fi

    # No existing record found; try to create via v4 (fallback to v2 if needed)
    create_url_v4="${base}/v4/domains/${domain}/records${team_q}"
    create_url_v2="${base}/v2/domains/${domain}/records${team_q}"
    body_create=$(jq -n --arg n "$name" --arg v "$value" --arg t "$type" --argjson ttl $ttl '{ name: $n, value: $v, type: $t, ttl: $ttl }')

    # try v4 create
    res=$(curl -sS -w "\n%{http_code}" -X POST -H "$auth_header" -H 'Content-Type: application/json' -d "$body_create" "$create_url_v4" || true)
    res_body=$(echo "$res" | sed -n '1,$p' | sed '$d' || true)
    res_code=$(echo "$res" | tail -n1 || echo "")
    if [ "$res_code" = "200" ] || [ "$res_code" = "201" ]; then
      return 0
    fi
    handle_auth_err "$res_code" "$res_body" || return 2

    # try v2 create as fallback
    res=$(curl -sS -w "\n%{http_code}" -X POST -H "$auth_header" -H 'Content-Type: application/json' -d "$body_create" "$create_url_v2" || true)
    res_body=$(echo "$res" | sed -n '1,$p' | sed '$d' || true)
    res_code=$(echo "$res" | tail -n1 || echo "")
    if [ "$res_code" = "200" ] || [ "$res_code" = "201" ]; then
      return 0
    fi
    handle_auth_err "$res_code" "$res_body" || return 2
    return 1
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

  # --- Configure nginx to proxy to relay-server (always, even without SSL) ---
  echo "Configuring nginx to proxy to relay-server"
  RELAY_PORT=$(echo "$RELAY_BIND" | awk -F: '{print $NF}')
  cat > /etc/nginx/sites-enabled/default <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;

    server_name _;

    location / {
        proxy_pass http://127.0.0.1:\${RELAY_PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
  # also ensure the common conf.d location is overridden so the default nginx welcome page cannot win
  cat > /etc/nginx/conf.d/default.conf <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;

    server_name _;

    location / {
        proxy_pass http://127.0.0.1:\${RELAY_PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
  # Start nginx
  nginx

  # --- SSL certificate via certbot (nginx) ---
  # We attempt to provision certs if RELAY_CERTBOT_EMAIL is set. Failures are non-fatal:
  # the container will continue to run HTTP only and will switch to HTTPS once certs exist.
  if [ -n "${RELAY_CERTBOT_EMAIL:-}" ]; then
    echo "Attempting SSL certificate provisioning for ${FQDN} (non-fatal)"

    # ensure certbot directories are present (persisted via hostPath)
    mkdir -p /etc/letsencrypt /var/lib/letsencrypt
    CERT_PRESENT=0
    if [ -d "/etc/letsencrypt/live/${FQDN}" ]; then
      if [ -f "/etc/letsencrypt/live/${FQDN}/fullchain.pem" ] && [ -f "/etc/letsencrypt/live/${FQDN}/privkey.pem" ]; then
        CERT_PRESENT=1
      fi
    fi

    if [ $CERT_PRESENT -eq 0 ]; then
      echo "No existing certs for ${FQDN}; attempting certbot (will retry up to 3 times)"
      for i in 1 2 3; do
        if certbot --nginx -d "${FQDN}" -m "${RELAY_CERTBOT_EMAIL}" --agree-tos --non-interactive ${RELAY_CERTBOT_STAGING:+--staging}; then
          echo "Certbot succeeded on attempt $i"
          CERT_PRESENT=1
          break
        else
          echo "Certbot attempt $i failed; will retry after backoff"
          sleep $((10 * i))
        fi
      done
    else
      echo "Found existing certs for ${FQDN}; skipping initial certbot run"
    fi

    if [ $CERT_PRESENT -eq 1 ]; then
      echo "Configuring nginx to proxy to relay-server with SSL for ${FQDN}"
      cat > /etc/nginx/sites-enabled/default <<EOF
server {
    listen 80;
    server_name ${FQDN};
    return 301 https://\$server_name\$request_uri;
}

server {
    listen 443 ssl;
    server_name ${FQDN};

    ssl_certificate /etc/letsencrypt/live/${FQDN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${FQDN}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    location / {
        proxy_pass http://127.0.0.1:${RELAY_PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
      nginx -s reload || true
    else
      echo "No certs obtained for ${FQDN}; continuing with HTTP only. You can inspect logs for certbot failures."
    fi
  else
    echo "RELAY_CERTBOT_EMAIL not set; skipping SSL certificate provisioning"
  fi

  # Wait for relay-server to exit (foreground)
  wait ${RELAY_PID}
}

main "$@"

