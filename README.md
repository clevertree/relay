Relay Monorepo (pnpm + Rust + Tauri)

Overview

This monorepo hosts the Relay Network reference implementation:
- apps/server — Rust Relay Server that serves and commits files directly from a Git repository via a simple HTTP API.
- apps/client — Tauri (Rust) + React + TypeScript + Tailwind desktop client.
- apps/tracker — Next.js tracker that lists recent master peer sockets (already provided/deployed).
- packages/protocol — Shared OpenAPI spec describing the Relay API used by both Node and Rust.
- crates/hooks — Rust crate intended to be used as a Git hook runner for future metadata/index tasks.

What is the Relay API?

The Relay API describes CRUD operations on any repository path while selecting a Git branch via header. It also includes POST /status for server metadata and capabilities. Certain file types (html, js) are blocked for security.

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
- QUERY /{path?} — 501 Not Implemented (suggest using a local index DB).
- POST /status — Returns server status, branches, sample paths, and capabilities.

Security

- Disallowed file extensions for CRUD: .html, .htm, .js

Notes

- QUERY endpoint is intentionally left unimplemented but the recommended approach is to maintain a light-weight local database (e.g., SQLite) updated by Git hooks that index content metadata to support fast search.

Licensing

See each package for its own license where applicable.
