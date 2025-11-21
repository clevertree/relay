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

# Start git daemon (read/write, insecure)
git daemon --reuseaddr --base-path=/srv/relay/data --export-all --enable=receive-pack --informative-errors --verbose --detach --listen=0.0.0.0 --port=9418

# Start Relay server
exec /usr/local/bin/relay-server
