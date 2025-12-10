#!/bin/sh
# Minimal entrypoint for Relay all-in-one image.
# Starts IPFS, Deluge, clones bare repos from RELAY_MASTER_REPO_LIST, runs git-daemon, then execs relay-server.

set -e

# Helper: is_truthy VAR -> returns 0 if VAR is set to a truthy value (true, 1, yes)
is_truthy() {
  v=$(echo "${1:-}" | tr '[:upper:]' '[:lower:]')
  case "$v" in
    1|true|yes|y) return 0 ;;
    *) return 1 ;;
  esac
}

clone_master_repo_list() {
  # New multi-repo initialization using RELAY_MASTER_REPO_LIST
  ROOT=${RELAY_REPO_ROOT:-/srv/relay/data}
  mkdir -p "$ROOT"

  # If list is empty, nothing to clone (no fallbacks)
  if [ -z "${RELAY_MASTER_REPO_LIST:-}" ]; then
    echo "RELAY_MASTER_REPO_LIST is empty; no repositories will be cloned."
    return
  fi

  # Parse semicolon-separated list (POSIX sh compatible)
  repos="${RELAY_MASTER_REPO_LIST}"
  while [ -n "$repos" ]; do
    # Extract first URL (everything before semicolon)
    url="${repos%%;*}"
    if [ "$url" = "$repos" ]; then
      # No more semicolons, this is the last one
      rest=""
    else
      # Remove this URL and the semicolon from the remaining string
      rest="${repos#*;}"
    fi

    # Trim whitespace and process
    u=$(echo "$url" | tr -d ' \t\r\n')
    if [ -n "$u" ]; then
      # Derive repo name from URL last path segment; strip trailing .git
      name=$(echo "$u" | awk -F/ '{print $NF}' | sed 's/\.git$//' | tr -d ' \t')
      if [ -z "$name" ]; then
        echo "Skipping invalid URL: $u"
      else
        dest="$ROOT/${name}.git"
        if [ -d "$dest" ] && [ -d "$dest/objects" ]; then
          echo "Repo exists: $dest — skipping"
        else
          echo "Cloning $u -> $dest"
          if git clone --bare "$u" "$dest"; then
            echo "Cloned $name"
          else
            echo "Failed to clone $u; initializing empty bare repo at $dest"
            mkdir -p "$dest"
            git init --bare "$dest" || true
          fi
        fi
      fi
    fi

    # Move to next URL
    repos="$rest"
  done
}

start_ipfs() {
  IPFS_PATH=/srv/relay/ipfs
  if ! ipfs --repo "$IPFS_PATH" repo stat >/dev/null 2>&1; then
    IPFS_PATH="$IPFS_PATH" ipfs init
  fi
  # Ensure API and Gateway listen on all interfaces for local testing
  IPFS_PATH="$IPFS_PATH" ipfs config Addresses.API "/ip4/0.0.0.0/tcp/5001" >/dev/null 2>&1 || true
  IPFS_PATH="$IPFS_PATH" ipfs config Addresses.Gateway "/ip4/0.0.0.0/tcp/8082" >/dev/null 2>&1 || true
  # Enable high-performance swarm over TCP and QUIC
  IPFS_PATH="$IPFS_PATH" ipfs config --json Addresses.Swarm '["/ip4/0.0.0.0/tcp/4001","/ip4/0.0.0.0/udp/4001/quic-v1","/ip4/0.0.0.0/udp/4001/quic"]' >/dev/null 2>&1 || true
  # Allow remote control from localhost-only inside container for security by default
  # Note: Inside container, use http://127.0.0.1:5001 for RPC; from outside, bind is 0.0.0.0
  export IPFS_PATH
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
  # Conditionally start IPFS and Deluge based on environment flags
  # By default these are disabled in the Dockerfile (RELAY_ENABLE_IPFS=false, RELAY_ENABLE_TORRENTS=false)
  if is_truthy "${RELAY_ENABLE_IPFS:-false}"; then
    echo "RELAY_ENABLE_IPFS=true -> starting IPFS daemon"
    start_ipfs
  else
    echo "RELAY_ENABLE_IPFS not enabled; skipping IPFS startup"
  fi

  if is_truthy "${RELAY_ENABLE_TORRENTS:-false}"; then
    echo "RELAY_ENABLE_TORRENTS=true -> starting Deluge daemon"
    start_deluged
  else
    echo "RELAY_ENABLE_TORRENTS not enabled; skipping Deluge startup"
  fi
  # Initialize repositories strictly from RELAY_MASTER_REPO_LIST (no fallbacks)
  clone_master_repo_list
  start_git_daemon

  # Server treats RELAY_REPO_PATH as the repository ROOT directory
  export RELAY_REPO_PATH=${RELAY_REPO_PATH:-/srv/relay/data}
  
  # Determine bind address from RELAY_HTTP_PORT or use ephemeral port
  if [ -n "${RELAY_HTTP_PORT:-}" ] && [ "$RELAY_HTTP_PORT" != "0" ]; then
    # Use provided HTTP port
    export RELAY_BIND="0.0.0.0:${RELAY_HTTP_PORT}"
    echo "Using RELAY_HTTP_PORT=${RELAY_HTTP_PORT}; set RELAY_BIND=${RELAY_BIND}"
  elif [ -n "${RELAY_BIND:-}" ]; then
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

  # Ensure ACME webroot exists for certbot http-01 challenges (served by Rust at /.well-known/...)
  RELAY_ACME_DIR=${RELAY_ACME_DIR:-/var/www/certbot}
  mkdir -p "$RELAY_ACME_DIR"

  # Start the relay server in background so we can perform post-start tasks (peer upsert)
  echo "Starting relay-server (HTTP port: ${RELAY_HTTP_PORT:-80}, HTTPS port: ${RELAY_HTTPS_PORT:-443})"
  /usr/local/bin/relay-server serve --repo "$RELAY_REPO_PATH" --static "${RELAY_STATIC_DIR:-/srv/relay/www}" --bind "$RELAY_BIND" &
  RELAY_PID=$!

  # Start git-pull timer (triggers every hour) with re-clone attempts for missing repos
  start_git_pull_timer() {
    # First wait a bit to let the relay server start
    sleep 10

    while true; do
      sleep 3600  # Wait 1 hour
      echo "$(date): Running periodic git updates and repo checks..."

      # Attempt to re-clone any missing repos from RELAY_MASTER_REPO_LIST
      if [ -n "${RELAY_MASTER_REPO_LIST:-}" ]; then
        ROOT=${RELAY_REPO_ROOT:-/srv/relay/data}
        repos="${RELAY_MASTER_REPO_LIST}"
        while [ -n "$repos" ]; do
          url="${repos%%;*}"
          if [ "$url" = "$repos" ]; then
            rest=""
          else
            rest="${repos#*;}"
          fi

          u=$(echo "$url" | tr -d ' \t\r\n')
          if [ -n "$u" ]; then
            name=$(echo "$u" | awk -F/ '{print $NF}' | sed 's/\.git$//' | tr -d ' \t')
            if [ -n "$name" ]; then
              dest="$ROOT/${name}.git"
              # Check if repo is missing or incomplete
              if [ ! -d "$dest" ] || [ ! -d "$dest/objects" ]; then
                echo "$(date): Attempting to clone missing repo: $u -> $dest"
                if git clone --bare "$u" "$dest" 2>&1; then
                  echo "$(date): Successfully re-cloned $name"
                else
                  echo "$(date): Failed to re-clone $u; will retry on next cycle"
                fi
              fi
            fi
          fi
          repos="$rest"
        done
      fi

      # Trigger git-pull on all existing repos via relay server API
      echo "$(date): Triggering git-pull on all repositories via relay API..."
      curl -s -X POST "http://localhost:${PORT_FOR_ADVERTISE}/git-pull" 2>/dev/null | jq '.' 2>/dev/null || echo "$(date): git-pull request completed (or timed out)"

      # Also directly fetch/prune on all bare repos to ensure up-to-date mirrors
      ROOT=${RELAY_REPO_ROOT:-/srv/relay/data}
      if [ -d "$ROOT" ]; then
        for repo in "$ROOT"/*.git; do
          [ -d "$repo" ] || continue
          if [ -d "$repo/objects" ]; then
            echo "$(date): Fetching updates in $repo"
            (cd "$repo" && git fetch --all --prune --tags 2>&1) || echo "$(date): Fetch failed in $repo"
          fi
        done
      fi
    done
  }
  start_git_pull_timer &
  GIT_PULL_TIMER_PID=$!

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
    # Use RELAY_HTTP_PORT for advertise
    PORT_FOR_ADVERTISE=${RELAY_HTTP_PORT:-80}
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
  # email: admin@<fqdn> (e.g., admin@node1.relaynet.online), name: admin
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

  # --- Automatic SSL via certbot (webroot) ---
  SSL_MODE=${RELAY_SSL_MODE:-auto}
  if [ -n "${RELAY_CERTBOT_EMAIL:-}" ] && [ -n "${FQDN:-}" ]; then
    echo "Attempting Let's Encrypt certificate provisioning for ${FQDN} (mode=${SSL_MODE})"
    # Obtain/renew certificate using webroot (served by Rust), no nginx involved
    if certbot certonly --webroot -w "$RELAY_ACME_DIR" -d "${FQDN}" -m "${RELAY_CERTBOT_EMAIL}" --agree-tos --non-interactive ${RELAY_CERTBOT_STAGING:+--staging}; then
      echo "Certbot obtained/renewed certificate for ${FQDN}"
      # Automatically set RELAY_TLS_CERT and RELAY_TLS_KEY to use the certbot certificate
      export RELAY_TLS_CERT="/etc/letsencrypt/live/${FQDN}/fullchain.pem"
      export RELAY_TLS_KEY="/etc/letsencrypt/live/${FQDN}/privkey.pem"
      echo "Using certbot certificate: RELAY_TLS_CERT=$RELAY_TLS_CERT"
      
      # Restart relay-server to pick up the certificate
      echo "Restarting relay-server to use certbot certificate..."
      kill ${RELAY_PID} 2>/dev/null || true
      sleep 2
      echo "Starting relay-server with certbot certificate (HTTP port: ${RELAY_HTTP_PORT:-80}, HTTPS port: ${RELAY_HTTPS_PORT:-443})"
      /usr/local/bin/relay-server serve --repo "$RELAY_REPO_PATH" --static "${RELAY_STATIC_DIR:-/srv/relay/www}" --bind "$RELAY_BIND" &
      RELAY_PID=$!
    else
      echo "Certbot failed to obtain certificate for ${FQDN}"
      if [ "$SSL_MODE" = "certbot-required" ]; then
        echo "RELAY_SSL_MODE=certbot-required: exiting due to certificate failure"
        kill ${RELAY_PID} || true
        exit 1
      fi
    fi
    # Background renewal loop
    (
      while true; do
        sleep 43200
        certbot renew --quiet || true
      done
    ) &
  else
    if [ "$SSL_MODE" = "certbot-required" ]; then
      echo "RELAY_SSL_MODE=certbot-required but RELAY_CERTBOT_EMAIL or FQDN not set; exiting"
      kill ${RELAY_PID} || true
      exit 1
    else
      echo "Skipping certbot provisioning (email or FQDN not set)."
    fi
  fi

  # Clean up background processes on exit
  cleanup() {
    echo "Cleaning up background processes..."
    [ -n "${GIT_PULL_TIMER_PID:-}" ] && kill $GIT_PULL_TIMER_PID 2>/dev/null || true
  }
  trap cleanup EXIT

  # Wait for relay-server to exit (foreground)
  wait ${RELAY_PID}
}

main "$@"

