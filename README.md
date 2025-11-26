Relay Monorepo (pnpm + Rust + Tauri)

Overview

This monorepo hosts the Relay Network reference implementation:
- apps/server — Rust Relay Server that serves and commits files directly from a Git repository via a simple HTTP API.
- apps/client — Tauri (Rust) + React + TypeScript + Tailwind desktop client.
- apps/tracker — Next.js tracker that stores peer sockets and the repositories/branches they serve (with branch HEAD commits).
- crates/relay-lib — Shared Rust library with HTTP client helpers and bundled assets (OpenAPI, rules schema, default HTML template, 404 page).
- crates/hooks — Rust crate used by Git hooks to validate repository rules and enforce insert constraints.

What is the Relay API?

The Relay API describes CRUD operations on any repository path while selecting a Git branch and repository subpath via headers/cookies/query. Discovery and capabilities are provided via the HTTP OPTIONS method (no `/status`). Certain file types (html, js) are blocked for writes.

Repository rules (relay.yaml)

- Each repository may contain a `relay.yaml` at its root describing what files are allowed to be inserted, the JSON Schema for `meta.json`, and a declarative database policy.
- These rules are enforced only for new commits (existing files are not retroactively validated).
- The JSON Schema for `relay.yaml` is bundled in `crates/relay-lib/assets/rules.schema.yaml` and exposed via the `relay_lib::assets` module for Rust.
- The Relay server returns discovery data (capabilities, branches, repos, current selections) via `OPTIONS` and honors the optional `indexFile` setting when rendering index documents.
- The commit hooks crate (`crates/hooks`) validates pushes using `relay.yaml` and rejects violations.
- The rules `db` section enables fully declarative indexing and querying using SQLite. All SQL features are allowed. The system binds named params like `:branch`, `:path`, `:meta_dir`, `:meta_json`, and `:meta_<field>` for top-level meta fields.

Example (movies) highlights:
- `allowedPaths` whitelist like `data/**/meta.json`, `data/**/index.md`, `data/**/assets/**`.
- `meta.json` schema: `title` (no trim), `release_date` (YYYY-MM-DD), and `genre` as an array of strings (multi-genre).
- `db.constraints: [title, release_date]` defines uniqueness; the branch is implied so uniqueness is `(title, release_date, branch)`.
- `db.insertPolicy.statements` control what is written to the DB (meta is NOT serialized/stored by default).
- `db.queryPolicy` provides a SQL statement (and optional count) used by the server `/query` endpoint with pagination.

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

Build and run an all-in-one image with Git daemon, Deluge (BitTorrent), IPFS, and the Relay server.

Build:
docker build -t relay-all-in-one .

Run (insecure; no auth):
docker run --rm -p 8088:8088 -p 9418:9418 \
  -p 4001:4001 -p 5001:5001 -p 8080:8080 \
  -p 58846:58846 -p 58946:58946 -p 58946:58946/udp \
  -v %cd%/data:/srv/relay/data \
  relay-all-in-one

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
  - `assets/rules.schema.yaml`
  - `assets/template.html` (placeholders: `{title}`, `{head}`, `{body}`)
  - `assets/404.md`
- The server resolves an HTML template in this order when rendering markdown or error pages:
  1. File named by env `RELAY_REPO_PATH_TEMPLATE_HTML` (defaults to `template.html`) in the same repo directory as the requested asset
  2. Ascend parent directories up to repo root looking for the file
  3. Fallback to bundled `relay-lib/assets/template.html`

Notes

- The local index database (SQLite/PoloDB) is created/updated by Git hooks based on `rules.db` policies. Do not store this database inside the Git repo.

Licensing

See each package for its own license where applicable.
