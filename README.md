Relay Monorepo (pnpm + Rust + Tauri)

Overview

This monorepo hosts the Relay Network reference implementation:
- apps/server — Rust Relay Server that serves and commits files directly from a Git repository via a simple HTTP API.
- apps/client — Tauri (Rust) + React + TypeScript + Tailwind desktop client.
- apps/tracker — Next.js tracker that lists recent master peer sockets (already provided/deployed).
- packages/protocol — Shared OpenAPI spec describing the Relay API used by both Node and Rust.
- crates/hooks — Rust crate used by Git hooks to validate repository rules and enforce insert constraints.

What is the Relay API?

The Relay API describes CRUD operations on any repository path while selecting a Git branch via header. It also includes POST /status for server metadata and capabilities. Certain file types (html, js) are blocked for security.

Repository rules (rules.yaml)

- Each repository may contain a `rules.yaml` at its root describing what files are allowed to be inserted, the JSON Schema for `meta.json`, and a declarative database policy.
- These rules are enforced only for new commits (existing files are not retroactively validated).
- The JSON Schema for `rules.yaml` lives at `packages/protocol/rules.schema.yaml`.
- The Relay server returns the parsed rules (as JSON) in `POST /status`, and honors the optional `indexFile` setting to suggest a default document.
- The commit hooks crate (`crates/hooks`) validates pushes using `rules.yaml` and rejects violations.
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

Run the Tracker (already included, optional local run)

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

API Summary

- Header: X-Relay-Branch: <branch> (default: main)
- GET /{path} — Return file bytes from repo at branch.
- PUT /{path} — Upsert file content; commits to branch.
- DELETE /{path} — Delete file; commits to branch.
- QUERY /{path?} — Policy-driven query backed by the local SQLite index. Default pagination pageSize=25; `X-Relay-Branch` may be a branch or `all`.
- POST /status — Returns server status, branches, sample paths (honors rules.indexFile), capabilities, and `rules` JSON if present.

Security

- Disallowed file extensions for CRUD: .html, .htm, .js

Notes

- The local index database (SQLite) is created/updated by Git hooks based on `rules.db` policies. Do not store this database inside the Git repo.

Licensing

See each package for its own license where applicable.
