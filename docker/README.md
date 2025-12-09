# Docker Configuration

This directory contains the Docker configuration for the Relay all-in-one container.

## Files

- `entrypoint.sh` - Main entrypoint script that orchestrates service startup

## Entrypoint Script

The entrypoint script (`entrypoint.sh`) handles the complete initialization of the Relay node:

### Services Started
1. **IPFS** - InterPlanetary File System daemon
2. **Deluge** - BitTorrent client daemon
3. **Git Daemon** - Git repository server
4. **Relay Server** - Main HTTP API server
5. **Nginx** - SSL proxy and web server (when SSL enabled)

### Key Features

#### Repository Initialization
- Clones template repository from `RELAY_TEMPLATE_URL` if repository doesn't exist
- Creates bare Git repository at `RELAY_REPO_PATH`
- Ensures at least one repository is available for serving

#### DNS Registration (Optional)
- Uses Vercel API to register DNS A records
- Requires `VERCEL_API_TOKEN` and optionally `VERCEL_TEAM_ID`
- Registers `RELAY_DNS_SUBDOMAIN.RELAY_DNS_DOMAIN` pointing to public IP

#### SSL Certificate Provisioning (Optional)
- Uses Let's Encrypt via certbot to obtain SSL certificates
- Requires `RELAY_CERTBOT_EMAIL` environment variable
- Automatically configures nginx for HTTPS proxy to relay-server
- Redirects HTTP to HTTPS

#### Nginx Proxy Configuration
- When SSL is enabled, configures nginx to proxy HTTPS requests to relay-server
- Extracts relay-server port from `RELAY_BIND` environment variable
- Sets up proper headers for proxy operation

### Environment Variables

See main README.md for complete environment variable documentation.

### Troubleshooting

#### Common Issues

**Entrypoint hangs or fails:**
- Check that all required environment variables are set
- Verify network connectivity for DNS and SSL operations
- Check logs: `docker logs <container>` or `kubectl logs <pod>`

**SSL certificate failures:**
- Ensure `RELAY_CERTBOT_EMAIL` is a valid email address
- Check that DNS is properly configured and propagated
- Use `RELAY_CERTBOT_STAGING=true` for testing

**Repository not initialized:**
- Verify `RELAY_TEMPLATE_URL` points to a valid Git repository
- Check that `/srv/relay/data` directory is writable
- Ensure git is available in the container

**Nginx proxy issues:**
- Verify relay-server is running on expected port
- Check nginx configuration: `docker exec <container> cat /etc/nginx/sites-enabled/default`
- Ensure SSL certificates were properly generated
- **Static fallback**: GET / should return 200 with HTML content (not 204); if it returns 204, check relay-server root handler

#### Manual Debugging

Access a running container:
```bash
docker exec -it <container> /bin/bash
# or for Kubernetes
kubectl exec -it <pod> -- /bin/bash
```

Check service status:
```bash
ps aux | grep -E "(relay-server|nginx|ipfs|deluge)"
```

Check nginx configuration:
```bash
cat /etc/nginx/sites-enabled/default
```

Check SSL certificates:
```bash
ls -la /etc/letsencrypt/live/
```

Check repository:
```bash
ls -la /srv/relay/data/
```

### Deployment Examples

#### Docker Compose
```yaml
version: '3.8'
services:
  relay:
    image: relay-all-in-one:latest
    ports:
      - "80:80"
      - "443:443"
      - "8088:8088"
    environment:
      - RELAY_CERTBOT_EMAIL=admin@example.com
      - RELAY_DNS_SUBDOMAIN=node1
      - VERCEL_API_TOKEN=your_token_here
    volumes:
      - ./data:/srv/relay/data
```

#### Kubernetes
See `terraform/rackspace-spot/k8s/relay-daemonset.yaml` for production deployment example.

### Testing

Run the local CORS and static fallback test:

```bash
./test_cors.sh
```

This validates CORS preflight, OPTIONS capabilities, and GET / static fallback.

For live testing:

```bash
curl -i https://your-domain.com/
# Should return 200 with HTML
```


### Local Docker plan (80/443 + 8080/8443)

This is the step-by-step plan we follow for local testing without regressing existing features:

1) Nginx listeners and routing (unified config)
- Global maps detect GET/HEAD and CORS preflight (`OPTIONS` + `Access-Control-Request-Method`).
- Port 80: serve ACME path; return `204` for preflight with full CORS headers; redirect everything else to HTTPS :443.
- Port 8080: no redirect; mirror HTTPS behavior for local testing. Universal CORS headers; handle preflight with `204`; proxy all other methods (including non‑preflight `OPTIONS`) to the relay backend; if backend returns `404` on `GET/HEAD`, serve static client from `/srv/relay/www` with SPA fallback to `index.html`.
- Ports 443 and 8443 (TLS): same behavior as 8080; use cert symlinks in `/etc/letsencrypt/live/relay/`; handle ACME path and CORS consistently.

2) Docker image
- Expose `80 443 8080 8443 8088` (plus existing ports). The relay-server listens on `8088` internally; Nginx proxies external ports to it.

3) Repository mounts
- Mount host `/data` to `/srv/relay/data` inside the container so any existing `*.git` repositories (e.g., `/data/repo.git`) are served alongside clones from `RELAY_MASTER_REPO_LIST`.
- The entrypoint clone logic skips repositories that already exist, and the hourly maintenance loop fetches/prunes to keep mirrors updated.

4) Local build and run
```bash
docker build -t relay-all-in-one:local .

docker run -d --name relay-local \
  -p 80:80 -p 443:443 -p 8080:8080 -p 8443:8443 \
  -e RELAY_ENABLE_IPFS=false -e RELAY_ENABLE_TORRENTS=false \
  -e RELAY_MASTER_REPO_LIST="" \
  -v $(pwd)/data:/srv/relay/data \
  -v $(pwd)/apps/client-web/dist:/srv/relay/www:ro \
  relay-all-in-one:local
```

5) Verification
- Static client: `curl -i http://localhost:8080/index.html` → `200`, HTML body, `Access-Control-Allow-Origin` present.
- Non‑preflight OPTIONS (capabilities): `curl -i -X OPTIONS http://localhost:8080/` → proxied relay response with CORS.
- CORS preflight: `curl -i -X OPTIONS -H "Origin: https://example.com" -H "Access-Control-Request-Method: GET" http://localhost:8080/` → `204` with `Access-Control-Allow-Origin`, `Access-Control-Allow-Methods`, `Access-Control-Allow-Headers` (echoed), and `Access-Control-Max-Age`.
- Optional TLS: Repeat the above on `https://localhost:8443` (accept self‑signed until Certbot is configured).
