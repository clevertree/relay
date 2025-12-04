Relay Monorepo (pnpm + Rust + Tauri)

Overview

This monorepo hosts the Relay Network reference implementation:
- apps/server — Rust Relay Server that serves and commits files directly from a Git repository via a simple HTTP API.
- apps/client — Tauri (Rust) + React + TypeScript + Tailwind desktop client.
- apps/tracker — Next.js tracker that stores peer sockets and the repositories/branches they serve (with branch HEAD commits).
- crates/relay-lib — Shared Rust library with HTTP client helpers and bundled assets (OpenAPI, default HTML template, 404 page).

What is the Relay API?

The Relay API describes CRUD operations on any repository path while selecting a Git branch and repository subpath via headers/cookies/query. Discovery and capabilities are provided via the HTTP OPTIONS method (no `/status`). Certain file types (html, js) are blocked for writes.

Repository hooks and validation

- Each repository can define custom validation logic in `.relay/pre-commit.mjs` (executed during PUT operations) and `.relay/pre-receive.mjs` (executed during git push).
- These hooks are executed in a sandboxed Node.js environment with access to git information (old commit, new commit, changed files).
- Repositories can optionally define `.relay/validation.mjs` with custom validation functions that can be called by the hook scripts.
- Index maintenance (e.g., tracking meta.json changes) is handled by the hook scripts and stored in `relay_index.json`.
- Discovery data (capabilities, branches, repos, current selections) is provided via `OPTIONS` method.

Quick Start

Prerequisites
- pnpm >= 9
- Node.js >= 18
- Rust toolchain (stable)
- Docker (to run the all-in-one daemon container)

Install workspace dependencies

1. Install JavaScript deps:
   pnpm install

2. Build Rust projects (optional at this stage):
   - Server: cargo build --manifest-path apps/server/Cargo.toml
   - Hooks:  cargo build --manifest-path crates/hooks/Cargo.toml

Run the Tracker (optional local run)

The tracker is already deployed to Vercel. To run locally:
pnpm -C apps/tracker dev

Run the Server (local)

Environment variables:
- RELAY_REPO_PATH — Path to a bare Git repository the server should serve (defaults to ./data/repo.git). If the path does not exist, the server will attempt to initialize a bare repo.
- RELAY_BIND — Address to bind (default 0.0.0.0:8088)

Run:
cargo run --manifest-path apps/server/Cargo.toml

Run the Client (Tauri desktop)

1. Install deps and start the React app in dev mode:
   pnpm -C apps/client install
   pnpm -C apps/client dev
2. To run Tauri desktop:
   pnpm -C apps/client tauri dev

Docker (all-in-one)

Build and run an all-in-one image with Git daemon, Deluge (BitTorrent), IPFS, nginx SSL proxy, and the Relay server.

## Environment Variables

### Core Configuration
- `RELAY_REPO_PATH` — Path to bare Git repository (default: `/srv/relay/data/repo.git`)
- `RELAY_BIND` — Server bind address (default: `0.0.0.0:8088`)
- `RELAY_TEMPLATE_URL` — URL to clone initial repository from (default: `https://github.com/clevertree/relay-template`)

### SSL & DNS Configuration
- `RELAY_CERTBOT_EMAIL` — Email for Let's Encrypt SSL certificates (required for HTTPS)
- `RELAY_DNS_DOMAIN` — Domain for DNS registration (default: `relaynet.online`)
- `RELAY_DNS_SUBDOMAIN` — Subdomain for this node (default: `node1`)
- `RELAY_CERTBOT_STAGING` — Use Let's Encrypt staging environment (set to `true` for testing)

### Vercel DNS Integration
- `VERCEL_API_TOKEN` — Vercel API token for DNS management
- `VERCEL_TEAM_ID` — Vercel team ID (optional)

## Build & Run

Build:
```bash
docker build -t relay-all-in-one .
```

Run (basic, no SSL):
```bash
docker run --rm -p 8088:8088 -p 9418:9418 \
  -p 4001:4001 -p 5001:5001 -p 8080:8080 \
  -p 58846:58846 -p 58946:58946 -p 58946:58946/udp \
  -v $(pwd)/data:/srv/relay/data \
  relay-all-in-one
```

Run (with SSL and DNS):
```bash
docker run --rm \
  -p 80:80 -p 443:443 \
  -p 8088:8088 -p 9418:9418 \
  -p 4001:4001 -p 5001:5001 -p 8080:8080 \
  -p 58846:58846 -p 58946:58946 -p 58946:58946/udp \
  -e RELAY_CERTBOT_EMAIL="your-email@example.com" \
  -e RELAY_DNS_SUBDOMAIN="your-node" \
  -e VERCEL_API_TOKEN="your-vercel-token" \
  -v $(pwd)/data:/srv/relay/data \
  relay-all-in-one
```

## Kubernetes Deployment

The project includes Terraform configuration for deploying to Kubernetes with automatic SSL certificates:

```bash
cd terraform/rackspace-spot
terraform init
terraform apply
```

### DaemonSet Configuration

The Kubernetes DaemonSet (`k8s/relay-daemonset.yaml`) deploys one pod per node with:
- Host networking for direct port access
- Automatic SSL certificate provisioning via Let's Encrypt
- DNS registration with Vercel API
- Persistent volume for repository data

### Troubleshooting

**SSL Certificate Issues:**
- Ensure `RELAY_CERTBOT_EMAIL` is set to a valid email
- Check certbot logs: `kubectl logs <pod-name>`
- Certificates are stored at `/etc/letsencrypt/live/<domain>/`

**Repository Not Serving:**
- Verify relay-server is running: `kubectl exec <pod> -- ps aux | grep relay`
- Check nginx proxy config: `kubectl exec <pod> -- cat /etc/nginx/sites-enabled/default`
- Ensure repository exists: `kubectl exec <pod> -- ls -la /srv/relay/data/`

**DNS Issues:**
- Verify Vercel API token has DNS management permissions
- Check DNS propagation: `dig <subdomain>.<domain>`
- Pod IP should match DNS A record

**Entrypoint Failures:**
- The entrypoint script handles repository initialization, SSL setup, and DNS registration
- Check logs for specific failure points
- Manual intervention may be needed for complex network setups

Repository Layout

- pnpm-workspace.yaml — pnpm workspaces configuration
- packages/protocol — OpenAPI spec and TS export
- apps/tracker — Next.js tracker (provided)
- apps/server — Rust server (axum + git2)
- apps/client — Tauri + React + TS + Tailwind
- crates/hooks — Git hooks runner crate (placeholder)

API Summary (Server)

- Headers:
  - `X-Relay-Branch: <branch>` (default: main)
  - `X-Relay-Repo: <repo-subdir>` (defaults to env or first repo directory)
- GET /{path} — Return file bytes scoped under the selected repo and branch.
- PUT /{path} — Upsert file content (commit) scoped to repo/branch.
- DELETE /{path} — Delete file (commit) scoped to repo/branch.
- QUERY /{path?} — Policy-driven query backed by the local index. Default pagination pageSize=25; `X-Relay-Branch` may be a branch or `all`.
- OPTIONS / and OPTIONS /* — Discovery payload: capabilities, branches, repos, currentBranch, currentRepo, branchHeads (branch → commit). If `X-Relay-Branch`/`X-Relay-Repo` are provided (or query `?branch=`/`?repo=`), the response is filtered accordingly.

Tracker API Summary
- GET /api/peers — `[{ id, socket, repos: string[], branches: [{ repo, branch, commit }], updatedAt }]`
- POST /api/peers/upsert — `{ socket, repos?: string[], branches?: [{ repo, branch, commit }] }`

Security

- Disallowed file extensions for write operations (PUT/DELETE): .html, .htm, .js
- JavaScript files that already exist in the repo can be loaded (GET) by clients. The commit hooks and server write rules prevent new JS from being added or modified via the API.
- Although HTML and JavaScript are forbidden from insertion rules, as long as they already exist in the repo, the server may render/serve them (e.g., via an HTML template). The rules forbid modifying files outside of what `relay.yaml` allows, so JavaScript can't be modified after the initial repo release through the API. In a later phase we will implement public-key signatures to allow secure modification of a small set of files via an admin key.

Bundled assets and templating
- The server and hooks do not access repo-local files from the source tree at runtime. Instead, shared assets are bundled inside `relay-lib`:
  - `assets/openapi.yaml`
  - `assets/template.html` (placeholders: `{title}`, `{head}`, `{body}`)
  - `assets/404.md`

Notes

- The local index database (if used) is created/updated by hook scripts and should not be stored inside the Git repo.

Licensing

See each package for its own license where applicable.

---

Custom repo-defined UI (hooks + layout)

Overview

The web client (apps/client-web) now supports repository-defined UI via optional hook scripts and a layout component stored inside the served repository. When present, these scripts let each repository control how files are rendered, how search results are displayed, and how creation forms look — without requiring extra build steps or dependencies in the web client.

**Important Principle:** The Relay client never defines or enforces repository data schemas. Only the repositories themselves define fields, file formats, and data structures within their hook scripts. The client only knows how to invoke hooks and render generic responses.

Key concepts

- Hook scripts (optional, inside the repo):
  - `/hooks/get.mjs` — handles reading and rendering a file path.
  - `/hooks/query.mjs` — handles search/QUERY and renders results.
  - `/hooks/put.mjs` — renders a Create form and performs PUT requests.
- Layout (optional, inside the repo):
  - `/ui/layout.mjs` or `/ui/layout.js` — a React component used to wrap hook-rendered content. If not present, the client falls back to its built-in `TemplateLayout`.
- FileRenderer (built-in, client-web):
  - A simple component that renders response bodies by MIME-type (markdown, images, text, json, etc.). Repos can use it from hooks.

How it works

1) The Repo Browser attempts to load `/hooks/get.mjs` from the target socket before doing a direct fetch. If found, the script is fetched and dynamically imported in the browser, and its `default` export is called with a context object. If not found, the browser falls back to a regular GET of the requested path.

2) The same mechanism is used for search and creation:
   - Search: a new Search box routes through `/hooks/query.mjs` if present.
   - Create: a new Create button routes through `/hooks/put.mjs` if present.

3) Layout selection: before invoking a hook, the client tries to load `/ui/layout.mjs` (or `.js`). If available, it is used as the `Layout` component. Otherwise, `apps/client-web/src/components/TemplateLayout.tsx` is used.

Hook execution context

Each hook’s default export receives a single `ctx` object with these fields:

```
{
  React,
  createElement,        // alias for React.createElement
  FileRenderer,         // client-provided component for MIME-aware rendering
  Layout,               // repo-provided layout if present, else a simple default
  params: {
    socket,             // current host ("node.example.com" or "host:port")
    path,               // current repository path ("/README.md", etc.)
    branch,             // selected branch if any
    repo,               // selected repo/subdir if any
    kind,               // 'get' | 'query' | 'put'
    ...extraParams,     // hook-specific (e.g., { q } for query)
  },
  helpers: {
    buildRepoHeaders,   // (branch?, repo?) => headers for Relay API
    buildPeerUrl,       // (path) => fully-qualified URL on the current socket
  }
}
```

Return value: The hook must return a React element (JSX or non-JSX via `createElement`).

Default examples in this repo

- `/hooks/get.mjs` — Performs a GET for the current `path` (scoped by branch/repo headers) and renders with `FileRenderer` wrapped by `Layout`.
- `/hooks/query.mjs` — Issues a `QUERY` request with the user’s `q` string and renders each result row.
- `/hooks/put.mjs` — Renders a basic form to create/update a file at the current directory, submitting via `PUT`.
- `/template/ui/layout.tsx` — A simple React layout component repos may copy and customize. If a JS module `/template/ui/layout.mjs` is also provided alongside or instead, the web client will prefer loading that at runtime.

Authoring hooks

- Use either JSX or non-JSX. The default files in this repo use non-JSX with `createElement` for maximum portability.
- Keep in mind these scripts are fetched and executed in the user’s browser. They should not rely on Node APIs.
- The server blocks writes of `.js/.html` via the API by default; you should ship these hook files as part of your repository’s initial content or out-of-band. Reads of existing `.mjs/.js` files are allowed, and the client can load them.

Client changes (summary)

- `apps/client-web/src/components/RepoBrowser.tsx` now:
  - Probes and loads `/hooks/get.mjs` before doing a direct fetch.
  - Adds a Create button wired to `/hooks/put.mjs` if available.
  - Adds a Search box wired to `/hooks/query.mjs` if available.
  - Tries to load `/template/ui/layout.mjs` or `.js` as the `Layout` wrapper before running a hook.
  - Falls back to direct GET fetch and the built-in `MarkdownRenderer`/`FileRenderer` when hooks are missing.

- `apps/client-web/src/components/FileRenderer.tsx` — new component for MIME-aware rendering.
- `apps/client-web/src/components/TemplateLayout.tsx` — default layout used if the repo does not provide one.

Usage flow

1. Open a peer in the web client and navigate to a path.
2. If the peer’s repo has `/hooks/get.mjs`, it controls rendering. Otherwise the file is fetched and rendered as markdown/text/image/etc.
3. Use the Create button to open the PUT hook UI (if present) to add a new file in the current directory.
4. Use the Search box to run queries via the repo’s `query.mjs` (if present).

Troubleshooting

- If a hook is not found, the client will show an error for that action and continue to work in fallback mode for GET.
- CORS: The client loads hooks and files from the same socket you are browsing; ensure your server serves these paths and allows GET/HEAD for hook files.
- MIME rendering: If a file renders as plain text, ensure the server sets `Content-Type` or customize rendering via your hook.
