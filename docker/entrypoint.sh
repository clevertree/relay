
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
  export RELAY_BIND=${RELAY_BIND:-0.0.0.0:8088}

  exec /usr/local/bin/relay-server
}

main "$@"

