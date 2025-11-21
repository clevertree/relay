
#!/bin/sh
set -e

# Initialize IPFS if needed
if ! ipfs --repo /srv/relay/ipfs repo stat >/dev/null 2>&1; then
  IPFS_PATH=/srv/relay/ipfs ipfs init
fi

# Start IPFS daemon
IPFS_PATH=/srv/relay/ipfs ipfs daemon &

# Start Deluge
deluged -d -c /var/lib/deluge &

# Ensure bare repo exists by cloning template if missing
if [ ! -d "${RELAY_REPO_PATH}" ] || [ ! -d "${RELAY_REPO_PATH}/objects" ]; then
  TEMPLATE_URL="${RELAY_TEMPLATE_URL:-https://github.com/clevertree/relay-template}"
  echo "Cloning bare repo from ${TEMPLATE_URL} to ${RELAY_REPO_PATH}..."
  mkdir -p "$(dirname "${RELAY_REPO_PATH}")"
  git clone --bare "${TEMPLATE_URL}" "${RELAY_REPO_PATH}"
fi

# Start git daemon (read/write, insecure)
git daemon --reuseaddr --base-path=/srv/relay/data --export-all --enable=receive-pack --informative-errors --verbose --detach --listen=0.0.0.0 --port=9418

# Start Relay server
exec env RELAY_REPO_PATH="${RELAY_REPO_PATH}" RELAY_BIND="${RELAY_BIND}" /usr/local/bin/relay-server

