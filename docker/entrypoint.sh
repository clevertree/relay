#!/bin/sh
# Minimal entrypoint for Relay all-in-one image.
# Starts IPFS, Deluge, ensures a bare repo exists, runs git-daemon, then execs relay-server.

set -e

clone_default_repo() {
  repo=${RELAY_REPO_PATH:-/srv/relay/data/repo.git}
  if [ ! -d "$repo" ] || [ ! -d "$repo/objects" ]; then
    tmpl=${RELAY_TEMPLATE_URL:-https://github.com/clevertree/relay-template}
    echo "Cloning bare repo from $tmpl to $repo (with 20s timeout; will fallback to git init --bare)"
    mkdir -p "$(dirname "$repo")"
    if ! timeout 20s git clone --bare "$tmpl" "$repo"; then
      echo "Template clone timed out or failed; creating empty bare repo at $repo"
      rm -rf "$repo" || true
      git init --bare "$repo" || echo "Failed to git init bare repo, continuing"
    fi
  fi
}

start_ipfs() {
  IPFS_PATH=/srv/relay/ipfs
  if ! ipfs --repo "$IPFS_PATH" repo stat >/dev/null 2>&1; then
    IPFS_PATH="$IPFS_PATH" ipfs init
  fi
  # Ensure API and Gateway listen on all interfaces for local testing
  IPFS_PATH="$IPFS_PATH" ipfs config Addresses.API "/ip4/0.0.0.0/tcp/5001" >/dev/null 2>&1 || true
  IPFS_PATH="$IPFS_PATH" ipfs config Addresses.Gateway "/ip4/0.0.0.0/tcp/8080" >/dev/null 2>&1 || true
  IPFS_PATH="$IPFS_PATH" ipfs daemon &
}

start_deluged() {
  # Run Deluge in background so entrypoint can continue
  # Use daemonized mode (no -d) or background the foreground mode
  deluged -c /var/lib/deluge >/var/log/relay/deluged.log 2>&1 &
  # Fallback: if daemonization fails, try foreground mode in background
  sleep 1
  if ! pgrep -x deluged >/dev/null 2>&1; then
    deluged -d -c /var/lib/deluge >/var/log/relay/deluged.log 2>&1 &
  fi
}

start_git_daemon() {
  git daemon --reuseaddr --base-path=/srv/relay/data --export-all --enable=receive-pack --informative-errors --verbose --detach --listen=0.0.0.0 --port=9418 || true
}

main() {
  start_ipfs
  start_deluged
  clone_default_repo
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

  # Configure git identity as requested to avoid commit prompts/errors
  # email: admin@<fqdn> (e.g., admin@node-dfw1.relaynet.online), name: admin
  git config --global user.email "admin@${FQDN}" || true
  git config --global user.name "admin" || true

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
    # Creation policy: default to no-create unless explicitly allowed
    ALLOW_CREATE="${RELAY_DNS_ALLOW_CREATE:-false}"
    # Helper: case-insensitive boolean check
    is_true() { case "${1:-}" in 1|[Tt][Rr][Uu][Ee]|[Yy][Ee][Ss]) return 0;; *) return 1;; esac; }

    # Helper to exit on auth errors
    handle_auth_err() {
      status="$1"; body="$2"
      if echo "$body" | grep -qi 'forbidden' || [ "$status" = "401" ] || [ "$status" = "403" ]; then
        echo "Vercel auth error (status=$status): $body"
        return 2
      fi
      return 0
    }

    # Build list URL with proper query separators and exact filters
    if [ -n "${VERCEL_TEAM_ID:-}" ]; then
      list_url="${base}/v4/domains/${domain}/records?teamId=${VERCEL_TEAM_ID}&name=${name}&type=${type}"
    else
      list_url="${base}/v4/domains/${domain}/records?name=${name}&type=${type}"
    fi
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

    # If record exists in v4, PATCH via v4 (exact match only)
    if [ -n "$rec_id" ]; then
      if [ -n "${VERCEL_TEAM_ID:-}" ]; then
        patch_url="${base}/v4/domains/${domain}/records/${rec_id}?teamId=${VERCEL_TEAM_ID}"
      else
        patch_url="${base}/v4/domains/${domain}/records/${rec_id}"
      fi
      body=$(jq -n --arg v "$value" --argjson t $ttl '{ value: $v, ttl: $t }')
      res=$(curl -sS -w "\n%{http_code}" -X PATCH -H "$auth_header" -H 'Content-Type: application/json' -d "$body" "$patch_url" || true)
      res_body=$(echo "$res" | sed -n '1,$p' | sed '$d' || true)
      res_code=$(echo "$res" | tail -n1 || echo "")
      if [ "$res_code" = "200" ] || [ "$res_code" = "204" ]; then
        echo "DNS_UPSERT_UPDATED name=${name}.${domain} value=${value}"
        return 0
      else
        handle_auth_err "$res_code" "$res_body" || return 2
        # if not auth error, treat as failure
        return 1
      fi
    fi

    # No existing record found; consider creation policy first
    if ! is_true "$ALLOW_CREATE"; then
      echo "DNS_UPSERT_SKIPPED_CREATE name=${name}.${domain} reason=missing_record allow_create=false"
      return 0
    fi

    # Try to create via v4 (fallback to v2 if needed)
    if [ -n "${VERCEL_TEAM_ID:-}" ]; then
      create_url_v4="${base}/v4/domains/${domain}/records?teamId=${VERCEL_TEAM_ID}"
      create_url_v2="${base}/v2/domains/${domain}/records?teamId=${VERCEL_TEAM_ID}"
    else
      create_url_v4="${base}/v4/domains/${domain}/records"
      create_url_v2="${base}/v2/domains/${domain}/records"
    fi
    body_create=$(jq -n --arg n "$name" --arg v "$value" --arg t "$type" --argjson ttl $ttl '{ name: $n, value: $v, type: $t, ttl: $ttl }')

    # try v4 create
    res=$(curl -sS -w "\n%{http_code}" -X POST -H "$auth_header" -H 'Content-Type: application/json' -d "$body_create" "$create_url_v4" || true)
    res_body=$(echo "$res" | sed -n '1,$p' | sed '$d' || true)
    res_code=$(echo "$res" | tail -n1 || echo "")
    if [ "$res_code" = "200" ] || [ "$res_code" = "201" ]; then
      echo "DNS_UPSERT_CREATED name=${name}.${domain} value=${value}"
      return 0
    fi
    handle_auth_err "$res_code" "$res_body" || return 2

    # try v2 create as fallback
    res=$(curl -sS -w "\n%{http_code}" -X POST -H "$auth_header" -H 'Content-Type: application/json' -d "$body_create" "$create_url_v2" || true)
    res_body=$(echo "$res" | sed -n '1,$p' | sed '$d' || true)
    res_code=$(echo "$res" | tail -n1 || echo "")
    if [ "$res_code" = "200" ] || [ "$res_code" = "201" ]; then
      echo "DNS_UPSERT_CREATED name=${name}.${domain} value=${value}"
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
      echo "Could not determine public IP; continuing without DNS upsert"
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
      echo "DNS upsert failed after retries; proceeding without DNS update"
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
        proxy_pass http://127.0.0.1:${RELAY_PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
  # Remove any default nginx conf.d snippets to avoid duplicate default_server
  rm -f /etc/nginx/conf.d/* 2>/dev/null || true
  # Start nginx
  nginx

  # --- SSL certificate via certbot (nginx) ---
  # SSL strategy
  # Modes:
  #   RELAY_SSL_MODE=certbot-required -> obtain certs via certbot and FAIL if unavailable
  #   RELAY_SSL_MODE=selfsigned       -> generate a self-signed cert and enable HTTPS
  #   RELAY_SSL_MODE=auto (default)   -> if RELAY_CERTBOT_EMAIL set, try certbot (non-fatal), else HTTP only
  SSL_MODE=${RELAY_SSL_MODE:-auto}

  if [ "$SSL_MODE" = "selfsigned" ]; then
    echo "RELAY_SSL_MODE=selfsigned: generating self-signed cert and enabling HTTPS"
    mkdir -p /etc/ssl/certs /etc/ssl/private
    if [ ! -f /etc/ssl/private/relay-selfsigned.key ] || [ ! -f /etc/ssl/certs/relay-selfsigned.crt ]; then
      openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
        -subj "/CN=${FQDN}" \
        -keyout /etc/ssl/private/relay-selfsigned.key \
        -out /etc/ssl/certs/relay-selfsigned.crt
    fi
    cat > /etc/nginx/sites-enabled/default <<EOF
server {
    listen 80;
    server_name ${FQDN} _;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl;
    server_name ${FQDN} _;

    ssl_certificate /etc/ssl/certs/relay-selfsigned.crt;
    ssl_certificate_key /etc/ssl/private/relay-selfsigned.key;

    location / {
        proxy_pass http://127.0.0.1:${RELAY_PORT};
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF
    nginx -s reload || true

  elif [ -n "${RELAY_CERTBOT_EMAIL:-}" ]; then
    echo "Attempting SSL certificate provisioning for ${FQDN} ($SSL_MODE)"

    # ensure certbot directories are present (persisted via hostPath)
    mkdir -p /etc/letsencrypt /var/lib/letsencrypt
    # State files for retry/backoff management
    RELAY_CERT_STATE_DIR=/var/lib/letsencrypt
    LAST_ATTEMPT_FILE="$RELAY_CERT_STATE_DIR/.relay-certbot-last-attempt"
    LAST_SUCCESS_FILE="$RELAY_CERT_STATE_DIR/.relay-certbot-last-success"
    BACKOFF_INDEX_FILE="$RELAY_CERT_STATE_DIR/.relay-certbot-backoff-index"

    # Helper: write nginx SSL server block and reload
    write_ssl_nginx_and_reload() {
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
    }

    # Helper: single certbot attempt; returns 0 on success
    certbot_single_attempt() {
      echo "CERTBOT_ATTEMPT domain=${FQDN} mode=${SSL_MODE} staging=${RELAY_CERTBOT_STAGING:-false} ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      date -u +%s > "$LAST_ATTEMPT_FILE" || true
      if certbot --nginx -d "${FQDN}" -m "${RELAY_CERTBOT_EMAIL}" --agree-tos --non-interactive ${RELAY_CERTBOT_STAGING:+--staging}; then
        echo "CERTBOT_SUCCESS domain=${FQDN} ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        date -u +%s > "$LAST_SUCCESS_FILE" || true
        echo 0 > "$BACKOFF_INDEX_FILE" || true
        return 0
      else
        echo "CERTBOT_FAIL domain=${FQDN} ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        return 1
      fi
    }

    # Helper: compute backoff by index (POSIX sh compatible)
    get_backoff_delay() {
      bi="$1"
      case "$bi" in
        0) echo 1800 ;;
        1) echo 3600 ;;
        2) echo 7200 ;;
        3) echo 14400 ;;
        4) echo 28800 ;;
        5) echo 43200 ;;
        *) echo 86400 ;;
      esac
    }

    # Helper: background retry manager with exponential backoff + jitter (POSIX sh)
    certbot_retry_manager() {
      while true; do
        # If cert exists and is valid, sleep a while before checking again
        if [ -f "/etc/letsencrypt/live/${FQDN}/fullchain.pem" ] && [ -f "/etc/letsencrypt/live/${FQDN}/privkey.pem" ]; then
          if EXP=$(openssl x509 -in "/etc/letsencrypt/live/${FQDN}/fullchain.pem" -noout -enddate 2>/dev/null | cut -d= -f2); then
            EXP_EPOCH=$(date -u -d "$EXP" +%s 2>/dev/null || true)
            NOW_EPOCH=$(date -u +%s)
            SECS_LEFT=$((EXP_EPOCH - NOW_EPOCH))
            if [ -n "$EXP_EPOCH" ] && [ $SECS_LEFT -gt $((20*24*3600)) ]; then
              sleep 21600 & wait $! 2>/dev/null || true # sleep 6h
              continue
            fi
          fi
        fi

        # Compute backoff index
        idx=0
        if [ -f "$BACKOFF_INDEX_FILE" ]; then
          idx=$(cat "$BACKOFF_INDEX_FILE" 2>/dev/null || echo 0)
        fi
        if [ -z "$idx" ]; then idx=0; fi
        delay=$(get_backoff_delay "$idx")
        # Jitter up to 20% if /dev/urandom is available
        jitter=0
        if [ -r /dev/urandom ]; then
          # read a 16-bit unsigned int and mod it
          ur=$(od -An -N2 -tu2 /dev/urandom 2>/dev/null | tr -d ' ')
          if [ -n "$ur" ]; then
            # ensure divisor >=1
            div=$(( (delay / 5) + 1 ))
            jitter=$(( ur % div ))
          fi
        fi
        sleep_for=$((delay + jitter))

        echo "CERTBOT_NEXT_RETRY_IN seconds=${sleep_for} backoff_index=${idx} ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        sleep $sleep_for & wait $! 2>/dev/null || true

        if certbot_single_attempt; then
          write_ssl_nginx_and_reload
          printf %s 0 > "$BACKOFF_INDEX_FILE" || true
          sleep 21600 & wait $! 2>/dev/null || true # 6h
        else
          next=$((idx + 1))
          # cap at max index (>=6)
          if [ "$next" -gt 6 ]; then next=6; fi
          printf %s "$next" > "$BACKOFF_INDEX_FILE" || true
        fi
      done
    }
    CERT_PRESENT=0
    if [ -d "/etc/letsencrypt/live/${FQDN}" ]; then
      if [ -f "/etc/letsencrypt/live/${FQDN}/fullchain.pem" ] && [ -f "/etc/letsencrypt/live/${FQDN}/privkey.pem" ]; then
        CERT_PRESENT=1
      fi
    fi

    if [ $CERT_PRESENT -eq 0 ]; then
      echo "No existing certs for ${FQDN}; attempting immediate certbot run and enabling background retries"
      if certbot_single_attempt; then
        CERT_PRESENT=1
      else
        CERT_PRESENT=0
      fi
      certbot_retry_manager &
    else
      echo "Found existing certs for ${FQDN}; will still start background renewal manager"
      certbot_retry_manager &
    fi

    if [ $CERT_PRESENT -eq 1 ]; then
      write_ssl_nginx_and_reload
    else
      # Continue serving HTTP and let retry manager obtain cert later
      echo "No certs obtained for ${FQDN} yet; continuing with HTTP only and retrying in background."
    fi
  else
    if [ "$SSL_MODE" = "certbot-required" ]; then
      echo "RELAY_SSL_MODE=certbot-required but RELAY_CERTBOT_EMAIL not set; exiting"
      kill ${RELAY_PID} || true
      exit 1
    else
      echo "RELAY_CERTBOT_EMAIL not set; skipping SSL certificate provisioning"
    fi
  fi

  # Wait for relay-server to exit (foreground)
  wait ${RELAY_PID}
}

main "$@"

