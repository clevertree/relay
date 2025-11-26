#cloud-config
package_update: true
packages:
  - docker.io
runcmd:
  - [ sh, -lc, 'systemctl start docker || true' ]
  - [ sh, -lc, 'docker login ghcr.io -u $GHCR_USERNAME -p "$GHCR_PAT" || true' ]
  - [ sh, -lc, 'docker pull ghcr.io/clevertree/relay:latest' ]
  - [ sh, -lc, 'docker run -d --restart unless-stopped -p 80:80 -p 443:443 --env RELAY_DNS_SUBDOMAIN="$RELAY_DNS_SUBDOMAIN" --env CERTBOT_EMAIL="$CERTBOT_EMAIL" ghcr.io/clevertree/relay:latest' ]
