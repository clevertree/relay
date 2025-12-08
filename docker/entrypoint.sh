#!/bin/sh
# Minimal entrypoint for Relay all-in-one image.
# Starts IPFS, Deluge, ensures a bare repo exists, runs git-daemon, then execs relay-server.

set -e

clone_default_repo() {
  # Legacy single-repo initialization (kept for backward compatibility when RELAY_MASTER_REPO_LIST is empty)
  repo=${RELAY_REPO_PATH:-/srv/relay/data/repo.git}
  # If repo already exists and looks valid, keep it
  if [ -d "$repo" ] && [ -d "$repo/objects" ]; then
    echo "Using existing bare repo at $repo"
    return
  fi

  # Prefer copying a provided default repo from /data/repo.git (mount host ./data -> /data)
  if [ -d "/data/repo.git" ] && [ -d "/data/repo.git/objects" ]; then
    echo "Copying default bare repo from /data/repo.git to $repo"
    mkdir -p "$(dirname "$repo")"
    cp -a /data/repo.git "$repo"
    return
  fi

  # Otherwise, attempt to clone the template; if it fails, initialize an empty bare repo
  tmpl=${RELAY_TEMPLATE_URL:-https://github.com/clevertree/relay-template}
  echo "Cloning bare repo from $tmpl to $repo"
  mkdir -p "$(dirname "$repo")"
  if git clone --bare "$tmpl" "$repo"; then
    echo "Template cloned successfully"
  else
    echo "Template clone failed; initializing empty bare repo at $repo"
    git init --bare "$repo"
  fi
}

clone_master_repo_list() {
  # New multi-repo initialization using RELAY_MASTER_REPO_LIST
  ROOT=${RELAY_REPO_ROOT:-/srv/relay/data}
  mkdir -p "$ROOT"
  
  # Check if list is empty
  if [ -z "${RELAY_MASTER_REPO_LIST:-}" ]; then
    echo "RELAY_MASTER_REPO_LIST is empty; falling back to legacy single repo init"
    clone_default_repo
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
  start_ipfs
  start_deluged
  # Initialize repositories
  clone_master_repo_list
  start_git_daemon

  # Server now treats RELAY_REPO_PATH as the repository ROOT directory
  export RELAY_REPO_PATH=${RELAY_REPO_PATH:-/srv/relay/data}
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
  /usr/local/bin/relay-server serve --repo "$RELAY_REPO_PATH" --static /srv/relay/www --bind "$RELAY_BIND" &
  RELAY_PID=$!

  # Start git-pull timer (triggers every hour)
  start_git_pull_timer() {
    while true; do
      sleep 3600  # Wait 1 hour
      echo "$(date): Triggering git-pull..."
      curl -s -X POST "http://localhost:${PORT_FOR_ADVERTISE}/git-pull" 2>/dev/null | jq '.' || echo "git-pull request failed"
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

  # --- Configure nginx to proxy to relay-server (always, even without SSL) ---
  echo "Configuring nginx to proxy to relay-server on 8080"
  RELAY_PORT=$(echo "$RELAY_BIND" | awk -F: '{print $NF}')
  # Keep 8080 debug server block in a dedicated file so it isn't overwritten by SSL configs
  cat > /etc/nginx/sites-enabled/relay-8080.conf <<EOF
server {
    listen 8080 default_server;
    listen [::]:8080 default_server;

    server_name _;

    # Forward 405 responses (e.g., static handler on OPTIONS) to the relay server upstream
    error_page 405 = @proxy;

    # Ensure directory requests (like "/") serve index.html from client-web
    index index.html;

    # Serve static files (client-web) from the www directory
    root /srv/relay/www;

    # First try to serve static files from the www directory
    # If not found, proxy to the relay server
    location / {
        # Try to serve files from the www directory first
        try_files \$uri \$uri/ @proxy;

        # Set cache headers for static assets
        expires 1h;
        add_header Cache-Control "public, immutable";
    }

    # Proxy for API and repo endpoints
    location @proxy {
        proxy_pass http://127.0.0.1:$RELAY_PORT;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # Explicitly proxy API requests (for dynamic content)
    location ~ ^/(api|branches|repos|files|search|options)/ {
        # CORS headers to allow cross-origin requests
        add_header Access-Control-Allow-Origin "*" always;
        add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS, HEAD" always;
        add_header Access-Control-Allow-Headers "Content-Type, Authorization, X-Requested-With" always;

        proxy_pass http://127.0.0.1:$RELAY_PORT;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # Cache static assets; if not found in /srv/relay/www, proxy to relay-server (Git-backed)
    location ~ \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        try_files \$uri @proxy;
        expires 1h;
        add_header Cache-Control "public, immutable";
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

    location ~ ^/(api|branches|repos|files|search|options)/ {
        # CORS headers to allow cross-origin requests
        add_header Access-Control-Allow-Origin "*" always;
        add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS, HEAD" always;
        add_header Access-Control-Allow-Headers "Content-Type, Authorization, X-Requested-With" always;

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

    # Serve static files (client-web) from the www directory
    root /srv/relay/www;

    # Forward 405 responses (e.g., static handler on OPTIONS) to the relay server upstream
    error_page 405 = @proxy;

    # Ensure directory requests (like "/") serve index.html from client-web
    index index.html;

    # First try to serve static files from the www directory
    # If not found, proxy to the relay server
    location / {
        # Try to serve files from the www directory first
        try_files \$uri \$uri/ @proxy;

        # Set cache headers for static assets
        expires 1h;
        add_header Cache-Control "public, immutable";
    }

    # Proxy for API and repo endpoints
    location @proxy {
        proxy_pass http://127.0.0.1:$RELAY_PORT;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # Explicitly proxy API requests (for dynamic content)
    location ~ ^/(api|branches|repos|files|search|options)/ {
        # CORS headers to allow cross-origin requests
        add_header Access-Control-Allow-Origin "*" always;
        add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS, HEAD" always;
        add_header Access-Control-Allow-Headers "Content-Type, Authorization, X-Requested-With" always;

        proxy_pass http://127.0.0.1:$RELAY_PORT;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # Cache static assets; if not found in /srv/relay/www, proxy to relay-server (Git-backed)
    location ~ \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        try_files \$uri @proxy;
        expires 1h;
        add_header Cache-Control "public, immutable";
    }
}
EOF
      nginx -s reload || true
    else
      if [ "$SSL_MODE" = "certbot-required" ]; then
        echo "Certbot required but no certs obtained for ${FQDN}; stopping relay-server and exiting"
        kill ${RELAY_PID} || true
        exit 1
      else
        echo "No certs obtained for ${FQDN}; continuing with HTTP only (non-fatal)."
      fi
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

