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