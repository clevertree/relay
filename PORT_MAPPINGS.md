# Relay Docker Container Port Mappings

## Current Configuration

After restoring client-web to port 8080, the port mappings are:

| External Port | Internal Port | Service | Purpose |
|---------------|---------------|---------|---------|
| 8080 | 80 | nginx + client-web | Web UI (Relay client) |
| 8088 | 8088 | relay-server | Relay server API |
| 8082 | 8080 | IPFS Gateway | IPFS gateway access (was on 8080) |
| 5001 | 5001 | IPFS RPC | IPFS API endpoint |
| 4001 | 4001 | IPFS Swarm | IPFS peer discovery (TCP) |
| 4001/udp | 4001/udp | IPFS Swarm | IPFS peer discovery (QUIC) |
| 9418 | 9418 | git-daemon | Git protocol access |

## Quick Start with Docker

```bash
docker run -d --name relay-local \
  -p 8080:80 \
  -p 8088:8088 \
  -p 8082:8080 \
  -p 4001:4001 \
  -p 5001:5001 \
  -p 9418:9418 \
  -p 4001:4001/udp \
  relay-test:latest
```

## Accessing Services

- **Client-Web (Relay UI)**: http://localhost:8080
- **Relay Server API**: http://localhost:8088/api/config
- **IPFS Gateway**: http://localhost:8082 (currently port 8080 in old image)
- **IPFS RPC**: http://localhost:5001
- **Git Access**: git://localhost:9418

## Notes

- Port 8080 is now exclusively for the client-web/nginx
- IPFS gateway has been moved to port 8082 in the code (requires rebuild with updated Dockerfile)
- The container currently running uses the old image where IPFS gateway is still on 8080, but it's mapped to external port 8082
- When rebuilding the image, IPFS will be configured to use port 8082 internally
