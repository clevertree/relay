#!/bin/sh
# Cleanup Vercel DNS records for a given domain/subdomain that match a stale IP
# Usage: VERCEL_TOKEN=xxx ./cleanup-vercel-dns.sh relaynet.online node1 172.99.115.81

set -e
if [ $# -lt 3 ]; then
  echo "Usage: $0 <domain> <subdomain> <stale-ip>"
  exit 2
fi
DOMAIN="$1"
SUBDOMAIN="$2"
STALE_IP="$3"
VERCEL_TOKEN="${VERCEL_TOKEN:-$VERCEL_API_TOKEN}"
if [ -z "$VERCEL_TOKEN" ]; then
  echo "Set VERCEL_TOKEN or VERCEL_API_TOKEN in env"
  exit 2
fi
BASE="https://api.vercel.com"
TEAM_Q=""
# optional TEAM_ID env var
if [ -n "${VERCEL_TEAM_ID:-}" ]; then
  TEAM_Q="?teamId=${VERCEL_TEAM_ID}"
fi

# list records
LIST_URL="${BASE}/v4/domains/${DOMAIN}/records${TEAM_Q}&name=${SUBDOMAIN}&type=A"
res=$(curl -sS -H "Authorization: Bearer ${VERCEL_TOKEN}" "$LIST_URL")
ids=$(echo "$res" | jq -r '.records[] | select(.value=="'"${STALE_IP}"'" ) | .id')
if [ -z "$ids" ]; then
  echo "No A records for ${SUBDOMAIN}.${DOMAIN} with value ${STALE_IP}"
  exit 0
fi
for id in $ids; do
  echo "Deleting record id $id for ${SUBDOMAIN}.${DOMAIN} -> ${STALE_IP}"
  del_url="${BASE}/v4/domains/${DOMAIN}/records/${id}${TEAM_Q}"
  curl -sS -X DELETE -H "Authorization: Bearer ${VERCEL_TOKEN}" "$del_url" || true
done

echo "Done"
