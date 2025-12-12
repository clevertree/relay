```

## Containerized Deployment (Nginx + Certbot, unified config)

The all-in-one Docker image runs:
- relay-server (HTTP API)
- nginx (TLS termination and reverse proxy)
- optional background services used by hooks (IPFS, Deluge)

Nginx is configured from a single file `docker/nginx-relay.conf` and:
- Proxies ALL requests (including `OPTIONS`) to the relay backend.
- If the backend returns 404 and the method is `GET`/`HEAD`, it serves static client-web files from `/srv/relay/www` with SPA fallback to `index.html`.
- Serves ACME challenges from `/.well-known/acme-challenge/` for Let’s Encrypt.
- Redirects HTTP (80) to HTTPS (443) and enables HTTP/2.

### Build and Run

```bash
# Build the image
docker build -t relay-all-in-one:latest .

# First run: self-signed TLS until Certbot succeeds
docker run -d \
  --name relay \
  -p 80:80 -p 443:443 \
  -e FQDN=node1.example.com \
  -e RELAY_CERTBOT_EMAIL=admin@example.com \
  -e RELAY_MASTER_REPO_LIST="https://github.com/you/repo1.git;https://github.com/you/repo2.git" \
  -v $(pwd)/data:/srv/relay/data \
  -v $(pwd)/www:/srv/relay/www \
  -v $(pwd)/letsencrypt:/etc/letsencrypt \
  relay-all-in-one:latest

# Access: https://node1.example.com (or your host)
```

Notes:
- If `FQDN` and `RELAY_CERTBOT_EMAIL` are set, the entrypoint will attempt to obtain/renew a real certificate via Certbot in webroot mode and automatically reload nginx.
- Until issuance succeeds, nginx serves a temporary self-signed certificate via stable symlinks at `/etc/letsencrypt/live/relay/`.

### Environment Variables

Required for automated TLS (recommended):
- `FQDN` — Fully qualified domain name for this node (e.g., `node1.example.com`).
- `RELAY_CERTBOT_EMAIL` — Email for Let’s Encrypt registration and renewal notices.

TLS behavior:
- `RELAY_SSL_MODE` — `auto` (default), `certbot-required`.
  - `auto`: try Certbot when `FQDN` and `RELAY_CERTBOT_EMAIL` are provided; otherwise serve self-signed until available.
  - `certbot-required`: exit if a real certificate cannot be obtained.

Repositories:
- `RELAY_MASTER_REPO_LIST` — Semicolon-separated list of git URLs to clone as bare mirrors at startup. Example: `https://github.com/you/repo1.git;https://github.com/you/repo2.git`.
- `RELAY_REPO_ROOT` — Root directory for bare repos (default `/srv/relay/data`).
- `RELAY_REPO_PATH` — Exposed to relay-server as the repository root (defaults to `RELAY_REPO_ROOT`).

Public address (optional):
- `RELAY_PUBLIC_HOST` — Hostname to advertise if not using `FQDN`.

Vercel DNS (optional):
- `VERCEL_API_TOKEN` — If set, the container will upsert an A record for `${RELAY_DNS_SUBDOMAIN}.${RELAY_DNS_DOMAIN}` to the detected public IP.
- `RELAY_DNS_DOMAIN` — Domain for Vercel DNS (default `relaynet.online`).
- `RELAY_DNS_SUBDOMAIN` — Subdomain (default `node1`).
- `VERCEL_TEAM_ID` — Optional team scope for Vercel API calls.

### Volumes
- `/srv/relay/data` — Bare git repositories (persistent).
- `/srv/relay/www` — Static web root for client-web build artifacts (optional but recommended for SPA fallback).
- `/etc/letsencrypt` — Certbot certificates and renewal state (persistent).
- `/var/www/certbot` — ACME webroot (managed by entrypoint; not typically mounted).

### Runtime behavior
- relay-server is started by the entrypoint and proxied by nginx on 443; nginx also redirects 80→443.
- Certbot runs in webroot mode against `/var/www/certbot`. Successful issuance repoints stable symlinks under `/etc/letsencrypt/live/relay/` and reloads nginx.
- A background renewal loop (`certbot renew`) runs twice daily and reloads nginx on changes.
- Repository maintenance runs hourly:
  - Re-clone any missing repos from `RELAY_MASTER_REPO_LIST`.
  - Trigger server-side `POST /git-pull` on the relay API.
  - `git fetch --all --prune --tags` on all bare repos under `/srv/relay/data`.

## Project Structure

```
relay/
├── apps/
│   ├── client-web/           # React web client (TypeScript)
│   ├── client-react-native/  # React Native mobile app
│   ├── server/               # Rust relay-server (HTTP API)
│   └── shared/               # Shared utilities
├── crates/                   # Rust modules
├── template/                 # Template system and sample hooks/components
├── docs/                     # Documentation
├── docker/                   # Docker configuration (nginx-relay.conf, entrypoint.sh)
├── scripts/                  # Build/deploy scripts
├── terraform/                # Infrastructure as Code
└── data/                     # Persistent data and git repos
```

## Key Features

### Web Client
- React 19 + TypeScript
- SPA served by nginx as 404 fallback when backend returns 404 for `GET/HEAD`

### Protocol Implementation (relay-server)
- `OPTIONS` discovery, `GET/PUT/DELETE`, custom query interface
- Multi-branch repository handling and peer capabilities

### Nginx Routing Summary
- All methods, including `OPTIONS`, are proxied to relay-server.
- If the backend responds 404 on `GET/HEAD`, nginx serves `/srv/relay/www` and falls back to `/index.html` for SPA routes.
- ACME challenges are served from `/var/www/certbot` on both HTTP and HTTPS.

### CORS Policy
- All responses include `Access-Control-Allow-Origin: *` and expose `Content-Length, Content-Range, ETag`.
- Preflight detection: requests with method `OPTIONS` and header `Access-Control-Request-Method` are treated as CORS preflight by nginx.
  - Nginx responds `204 No Content` with:
    - `Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS`
    - `Access-Control-Allow-Headers: <echoed from request Access-Control-Request-Headers>`
    - `Access-Control-Max-Age: 86400`
    - `Access-Control-Allow-Origin: *`
  - This applies for all paths (including static files) and on both HTTPS:443 and HTTP:80. On port 80, nginx handles preflight directly (204) before redirecting other methods to HTTPS to avoid missing CORS headers during redirects.
- Non-preflight `OPTIONS` requests (no `Access-Control-Request-Method` header) are proxied to the relay server so it can return its capabilities JSON body.

### Examples

1) CORS preflight (handled by Nginx — returns 204)

```bash
curl -i -X OPTIONS \
  -H "Origin: https://example.com" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: X-Requested-With,Content-Type" \
  https://your-host/path
```

Expected: 204 No Content with headers:
- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS`
- `Access-Control-Allow-Headers: X-Requested-With,Content-Type`
- `Access-Control-Max-Age: 86400`

2) Non-preflight OPTIONS forwarded to relay-server (capabilities JSON)

```bash
curl -i -X OPTIONS https://your-host/path
```

Expected: proxied response from the relay-server (JSON capabilities) and `Access-Control-Allow-Origin: *` present.

4) Preflight sent to HTTP (port 80) still succeeds

```bash
curl -i -X OPTIONS \
  -H "Origin: https://example.com" \
  -H "Access-Control-Request-Method: GET" \
  http://your-host/
```

Expected: `204 No Content` with the same CORS headers; the redirect to HTTPS is only applied for non-preflight requests.

3) Static asset access

```bash
curl -i https://your-host/assets/app.js
```

Expected: `Access-Control-Allow-Origin: *` present on the static asset response.

Notes:
- If you need to allow credentials (cookies/Authorization) for cross-origin requests, do not use `*` for `Access-Control-Allow-Origin`. Instead, set the header dynamically to the `Origin` header and set `Access-Control-Allow-Credentials: true`; update `nginx` config accordingly.
- The nginx preflight handling is intentionally minimal and echoes requested headers. If you require a stricter header whitelist, update `add_header Access-Control-Allow-Headers ...` to a safe list.

## Building the Web Client

```bash
npm run build
# Place built assets into ./www and mount to /srv/relay/www in the container
```

## Troubleshooting

- Certificate issuance fails:
  - Ensure `FQDN` resolves publicly to the node’s IP and port 80 is reachable from the internet.
  - Set `RELAY_CERTBOT_STAGING=true` to use Let’s Encrypt staging for tests.
- Static files not served:
  - Verify your client build is present at `/srv/relay/www` in the container and includes `index.html`.
- Repos not syncing:
  - Confirm `RELAY_MASTER_REPO_LIST` is set and repositories are accessible; check logs for periodic fetch messages.

Key patterns:
- Use `/** @jsx h */` pragma for classic JSX runtime
- Export functions, not components
- Accept `h` (createElement) as first parameter
- No ES6 imports (use `helpers.loadModule()` for dynamic loading)
- Use optional `theme` parameter for styling

### Path Resolution

All paths within `/template` go through the centralized `resolvePath()` function:

```javascript
// In hooks:
const module = await helpers.loadModule('./components/Layout.jsx')
const url = helpers.resolvePath('hooks/client/get-client.jsx')

// Direct fetches:
const response = await fetch(helpers.resolvePath('/README.md'))
```

This ensures:
- No double slashes in URLs
- Consistent relative path handling
- Proper base URL joining using URL constructor

## Configuration

### .relay.yaml

Define hook paths and repository capabilities:

```yaml
name: "Movie Repository"
version: "1.0.0"
client:
  hooks:
    get:
      path: hooks/client/get-client.jsx
    query:
      path: hooks/client/query-client.jsx
```

### Environment Variables

- `NODE_ENV` - Development or production
- `VITE_API_URL` - Backend API URL
- `DOCKER_REGISTRY` - Container registry (for deployments)

## Deployment

### Local Docker
```bash
docker build -t relay:latest .
docker run -p 3000:3000 relay:latest
```

### Production Deployments
- See `/docs/relay-yaml-configuration.md` for OPTIONS setup
- See `/docs/web-client-architecture.md` for architecture
- See `terraform/` for infrastructure as code
- See `docker/` for container configurations

## Troubleshooting

### Dev Server Issues
- **404 errors** - Verify paths in `.relay.yaml` don't have leading slashes
- **Double slashes in URLs** - Use `resolvePath()` or native `URL` constructor
- **Module loading errors** - Check browser console for Babel transpilation errors
- **Content-Type wrong** - Verify dev-server's `contentTypeMap` includes file extension

### Template Component Errors
- **Unexpected token '<'** - Ensure files use `/** @jsx h */` pragma
- **Module not found** - Use relative paths starting with `./` for dynamic imports
- **Theme undefined** - Pass theme as optional parameter, provide fallback defaults

## Documentation

- [Web Client Architecture](/docs/web-client-architecture.md)
- [Plugin Interface](/docs/plugin-interface.md)
- [Relay YAML Configuration](/docs/relay-yaml-configuration.md)
- [Repository Script System](/docs/repo-script-system.md)
- [Cross-Platform Styling Guide](/docs/CROSS_PLATFORM_STYLING_GUIDE.md)
- [Template Refactoring](/docs/TEMPLATE_REFACTORING_COMPLETE.md)
- [Project Vision](/docs/relay_project_vision.md)

## Architecture Decisions

### Babel Standalone for JSX
Template components use `@babel/standalone` for runtime JSX transpilation. This allows:
- Dynamic component loading without build step
- Classic JSX runtime with `/** @jsx h */` pragma
- Hot component updates during development

Trade-offs:
- Transpilation happens in browser (slower, but acceptable for template components)
- No tree-shaking or code splitting for templates
- Components must avoid ES6 imports

### Monorepo Structure
- Single repo with multiple apps (web, mobile, server, extension)
- Shared utilities in `apps/shared/`
- Rust modules in `crates/` for performance-critical code
- Workspace setup allows coordinated releases

### Hook-Based Routing
Instead of traditional REST API:
- GET hooks render content for arbitrary paths
- Query hooks handle search/filtering
- PUT hooks handle form submissions
- Allows flexible content-driven routing

## Performance Considerations

- **Code Splitting** - Vite handles automatic code splitting in dev
- **Lazy Loading** - Components loaded on-demand via `helpers.loadModule()`
- **Caching** - Use cache headers on static assets
- **Streaming** - Large files use streaming via `streaming-files` crate

## Contributing

1. Create feature branch: `git checkout -b feature/name`
2. Make changes and test locally: `npm run web:dev:full`
3. Build and test Docker image
4. Push and create pull request
5. See `/docs/git-branch-rules.md` for branching strategy

## License

See LICENSE file for details.

## Support

- GitHub Issues: Report bugs and request features
- Documentation: See `/docs/` directory
- Vision Document: `/docs/relay_project_vision.md`

## React Native (Android) — Build and Install Release APK

Devices are online and ready to accept APKs. Use the provided scripts to assemble and install the Android release build:

```bash
# From repo root

# 1) Start Metro in a separate terminal if needed
npm run rn:start

# 2) Build and install the release APK to a connected device (requires adb)
npm run rn:build:release

# Alternatively, run steps manually:
npm run rn:android:assembleRelease
npm run rn:android:installRelease
```

Notes:
- If installation fails with an unsigned APK error, configure signing in `apps/client-react-native/android/app/build.gradle`.
- The RN client includes a Settings toggle (in Debug tab) to choose Client or Server transpiler mode. Default is Client. Server mode posts to `/api/transpile` and executes returned CommonJS.

## Release Validation

For end-to-end validation steps across the hook-transpiler crate, server `/api/transpile`, client‑web (WASM and server modes), and React Native (Android) release APK, see:

- docs/RELEASE_VALIDATION.md
