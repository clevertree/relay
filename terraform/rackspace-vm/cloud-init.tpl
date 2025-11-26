#cloud-config
package_update: true
packages:
  - docker.io
runcmd:
  - [ sh, -lc, 'systemctl start docker || true' ]
  - [ sh, -lc, 'docker login ghcr.io -u $GHCR_USERNAME -p "$GHCR_PAT" || true' ]
  - [ sh, -lc, 'docker pull ghcr.io/clevertree/relay:latest' ]
  - [ sh, -lc, 'docker run -d --restart unless-stopped -p 80:80 -p 443:443 \
        -e RELAY_DNS_SUBDOMAIN="$RELAY_DNS_SUBDOMAIN" \
        -e RELAY_DNS_DOMAIN="$RELAY_DNS_DOMAIN" \
        -e RELAY_CERTBOT_EMAIL="$RELAY_CERTBOT_EMAIL" \
        -e VERCEL_API_TOKEN="$VERCEL_API_TOKEN" \
        ghcr.io/clevertree/relay:latest' ]
