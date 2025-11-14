# Relay Implementation Plan

Last updated: 2025-11-13

This document converts the high-level requirements from README into a concrete, phased implementation plan. It also defines the target repository structure, component responsibilities, interfaces, and acceptance criteria.

## 1. Objectives
- Deliver a decentralized content distribution platform with dual-mode clients (desktop via Tauri, web via WASM), shared core library, and a host mode that serves static content and git-backed repositories.
- Enforce repository schemas on the server side using git hooks and shared validation logic.
- Support IPFS-based content distribution with a default "movies" repository template.

## 2. Target Repository Structure
A unified monorepo with Rust + TypeScript workspaces.

```
relay/
├─ crates/                           # Rust workspace members
│  ├─ relay-core/                    # Shared library: crypto, repo mgmt, IPFS, HTTP client/server, schema validation
│  │  ├─ src/
│  │  ├─ tests/
│  │  └─ Cargo.toml
│  ├─ relay-cli/                     # CLI for host mode ops + user utilities
│  │  ├─ src/main.rs
│  │  ├─ tests/
│  │  └─ Cargo.toml
│  └─ relay-wasm/                    # WASM bindings to a subset of relay-core
│     ├─ src/lib.rs
│     ├─ package.json                # published as an npm package for the web app
│     ├─ build.rs
│     └─ Cargo.toml
│
├─ apps/
│  ├─ web/                           # Next.js 14 app (static export capable)
│  │  ├─ app/                        # App Router
│  │  ├─ public/
│  │  ├─ src/
│  │  ├─ package.json
│  │  └─ next.config.mjs
│  └─ desktop/                       # Tauri wrapper embedding web static export
│     ├─ src-tauri/
│     │  ├─ src/
│     │  ├─ tauri.conf.json
│     │  └─ Cargo.toml
│     ├─ package.json
│     └─ README.md
│
├─ host/                             # Files served in host mode
│  ├─ repos/                         # Git repositories (bare or working)
│  ├─ static/                        # Static assets (Next.js export)
│  └─ hooks/                         # Git hooks (server-side)
│
├─ template/
│  └─ movies/                        # Template for `movies` repository
│     ├─ .relay/
│     │  ├─ schema.yaml              # Repository schema
│     │  └─ interface.md             # UI hints & content for the repo browser
│     └─ README.md
│
├─ docs/
│  ├─ PLAN.md                        # This document
│  └─ ARCHITECTURE.md                # Optional deeper technical docs
│
├─ scripts/                          # Dev and CI scripts (PowerShell + cross-platform when possible)
│  ├─ dev.ps1
│  ├─ build.ps1
│  └─ ci.ps1
│
├─ Cargo.toml                        # Rust workspace
├─ package.json                      # Root npm scripts (lint, test, build)
├─ turbo.json | nx.json (optional)   # Monorepo task runner
└─ README.md
```

Notes:
- `host/` is runtime data; in production it may be mounted or volume-mapped. Hooks are provisioned by CLI.
- Repositories may be bare (+ working trees elsewhere) or non-bare. Start simple with non-bare in `host/repos/<name>`.

## 3. Components and Responsibilities

### 3.1 relay-core (Rust)
- Crypto utilities (keys, signatures; pluggable KMS later)
- Repository management (init, open, validate)
- Git protocol server/client using mygit (feature-gated)
  - Cargo feature `git` enabled by default for native builds; disabled in WASM targets
  - Default server port `9418` (configurable)
  - Start/stop lifecycle controlled by host mode
  - Advertise refs; support clone/fetch/pull/push
  - AuthNZ: v1 anonymous (read and push); future enforcement of signed transactions
  - Default branch: master
- Schema engine
  - Load `.relay/schema.yaml`
  - Validate staged commits (files, JSON/YAML structure, size limits, media types)
  - Expose `validate_commit(repo_path) -> Result<()>`
- Interface model
  - Parse `.relay/interface.md`
  - Enumerate safe asset types the UI can load
- IPFS
  - Abstraction trait so implementations can be swapped (WebIPFS vs native)
  - Basic get/add with progress callbacks
- HTTP server (host mode)
  - Serve static from `host/static`
  - Serve repository files per schema constraints
  - Endpoints for listing repos, reading allowed files, and submitting changes (optional)
- HTTP client
  - Fetch repository directory listings and file contents from host server
- Config loader/saver
  - Default path `~/.relay/config.toml` with overrides via env and CLI flags

### 3.2 relay-cli (Rust)
- Commands (draft):
  - `relay init --repo <name> --template movies --path <host/repos>`
  - `relay host start --port 8080 --root ./host` (serves static + repos; also starts git protocol server if enabled)
  - `relay host stop` (if running as background service)
  - `relay repo validate --path <repo>`
  - `relay repo list --root ./host/repos`
  - `relay config get|set <key> [value]`
  - `relay ipfs add <path>` / `relay ipfs get <hash> [--out <dir>]`
  - `relay git clone <peer-or-url> <local-path>`
  - `relay git fetch <peer-or-url> [<ref>]`
  - `relay git pull <peer-or-url> [<branch>]`
  - `relay git push <peer-or-url> [<branch>]`
  - `relay git commit -m <msg>` (optional convenience wrapper for local commits)
- Notes:
  - `relay git *` subcommands are thin wrappers over the mygit client; where appropriate they may shell out to system git for local workspace ops.
- Hook provisioning: install `pre-receive` (or `pre-commit` for local) that calls `relay-core` validation

### 3.3 relay-wasm (Rust -> WASM)
- Bind a subset of relay-core that is browser-safe
  - Repo browsing via HTTP client only (no filesystem write by default)
  - IPFS via WebIPFS APIs
  - Config stored in OPFS/IndexedDB
- Publish npm package consumed by `apps/web`

### 3.4 Web App (Next.js + TS + MUI)
- Static export for public web; same build embedded in Tauri
- Pages/Routes:
  - Home: list available repositories (from host server)
  - Repo Browser: render content per `.relay/interface.md` with safe asset allowlist
  - Settings: edit config (persist immediately)
- State mgmt via Zustand; forms via React Hook Form
- Networking via Axios; WASM module lazy-loaded where needed

### 3.5 Desktop (Tauri)
- Embeds static export; provides native commands routing to relay-core when needed
- Extended capabilities: filesystem access for local clone, cache, and IPFS pinning

### 3.6 Host Mode Runtime
- Directory layout rooted at `<app dir>/host`
- Static server serves `host/static` and whitelisted repo files
- Git protocol server (mygit) listens on `git.port` (default `9418`); serves repos from non-bare `host/repos/<name>` (no `.git` suffix)
  - Namespace: flat — remotes like `git://<host>:<port>/<repo-name>`
  - Lifecycle: started/stopped together with `relay host start/stop`
- Repos in `host/repos/<name>`
- Clients in web mode use HTTP GET with caching

## 4. Data Flows

1) Browse repository in web mode
- Web app -> Host HTTP API: list repos
- Web app -> Host HTTP API: fetch files (only safe types)
- Optional: cache in OPFS or <appdir>/cache, keyed by ETag/Last-Modified

2) Commit path in host mode
- User edits repo locally
- Hook fires `pre-commit`/`pre-receive` -> `relay-core::validate_commit`
- Reject or accept commit; log reasons

3) IPFS download/stream
- UI requests file by hash -> WebIPFS / native IPFS adapter
- Progress events surfaced to UI

4) Git clone/fetch/push between clients
- Client B runs `relay git clone git://<ClientA>:9418/<repo>`
- Uses mygit client to negotiate refs and stream packfiles
- Hooks on server validate pushes (`pre-receive`) via relay-core
- Authentication/authorization: TBD (initially local/LAN, optional allowlist)

## 5. Configuration
- Path: `~/.relay/config.toml` (default)
- Keys (initial):
  - `master_endpoint = "https://node1.relaynet.online"`
  - `data_path = "<appdir>/host"`
  - `http.port = 8080`
  - `git.port = 9418`  # mygit protocol default
  - `git.shallow_default = true`  # default clone depth behavior (true = shallow, false = full)
  - `features.web_only = true|false`

## 6. HTTP API (Host Mode) — Draft
- `GET /api/repos` -> `[ { name, path, description } ]`
- `GET /api/repos/:name/tree?path=...` -> directory listing (filtered by allowlist)
- `GET /api/repos/:name/file?path=...` -> raw file (only allowed types)
- `GET /static/*` -> static assets
- `POST /api/repos/:name/validate` -> validate current head (auth TBD)

Security: enforce allowlist of extensions in server and client. Deny JS and any executable content.

## 7. Repository Schema (`.relay/schema.yaml`)
- Define content types, fields, constraints (e.g., movies: title, year, ipfs_hash, poster path)
- Validation rules for directory structure and file types
- Example minimal schema lives in `template/movies/.relay/schema.yaml`
- Root-level `relay.yaml` in each repository defines repository metadata (version, title, description, index), primary content path template, and named indices.
- Reference schema file: `schema/relay.schema.yaml` (JSON Schema in YAML) documents/validates the shape of `relay.yaml`.
- Rust: `relay-wasm` exposes `parse_repo_schema(yaml: &str)` using `serde_yaml` to read basic fields (a) metadata, (b) content info path, (c) indices accessible by name.
- Web: UI performs minimal client-side validation now; full JSON Schema validation against `schema/relay.schema.yaml` is planned.

## 8. Testing Strategy
- Rust: `cargo test` for core, CLI; clippy + fmt gates
- Web: Vitest for units, React Testing Library for components
- E2E: Cypress for web, WebdriverIO for Tauri
- Integration: API routes and CLI commands
- Minimal seed tests per feature/pr milestone

## 9. CI/CD
- GitHub Actions matrix: Windows, macOS, Linux for Rust; Node 20 for web
- Jobs: lint, test, build; upload artifacts (static export, Tauri bundle)
- Optional: Docker image build for host mode

## 10. Docker
- Base image: `rust:1.91` + Node 20 for builder; distroless/alpine runtime
- Expose port (e.g., 8080)
- Mount volume for `host/`

## 11. Milestones and Acceptance Criteria

M1 — Repository bootstrap
- Create workspace scaffolding and templates
- Implement config loader
- Implement schema file parser (no validation yet)
- Accept: `cargo build` works, web app creates, `template/movies` present

M2 — Schema validation + CLI hooks
- Implement validation rules and CLI `repo validate`
- Hook installation and rejection on invalid commits
- Accept: failing commit shows error; passing commit allowed

M3 — Git service via system Git + CLI `relay git`
- Use the system `git daemon` for serving repositories (started via `relay host start` or `relay git-daemon start`)
- Implement `relay git clone|fetch|pull|push` as thin wrappers over the system Git client
- Accept:
  - `relay git-daemon start --base-path <host/repos> --port 9418` serves repos on LAN
  - From Client B, `git clone git://ClientA:9418/movies` succeeds (shallow when configured)
  - Push from B to A triggers validation hooks (`pre-receive` calling `relay hooks pre-receive`) and rejects invalid commits

M4 — Host HTTP server + web browser
- Serve static and repo files with allowlist enforcement
- Web app lists repos and browses `movies`
- Accept: navigate and read files; JS blocked

M5 — IPFS basic operations
- Add/get with progress in CLI and web (WASM)
- Accept: can download a small asset by IPFS hash

M5 — Desktop app (Tauri)
- Embed static export; native commands wired to core
- Accept: same UX as web, plus local storage features

M6 — Packaging + Docker + CI
- CI green; Docker image for host mode
- Accept: one-click run of host mode via Docker; CI badges

## 12. Risks and Mitigations
- WASM limitations: FS and sockets — use HTTP + OPFS; feature-gate APIs
- Security of file serving — strict allowlist; content-type checks; no directory traversal
- Git hooks portability — provide CLI to install and test; document Windows specifics
- IPFS availability — use adapters and allow offline/no-op in dev

## 13. Open Questions for the Maintainers
- Should repositories be bare with a separate working tree, or simple non-bare repos in `host/repos/<name>` for v1?
- Minimum viable IPFS: integrate with a local daemon, or rely on WebIPFS-only for v1?
- Is NEAR Protocol integration required in v1 core, or scheduled for a later milestone?
- Preferred port and base path for host HTTP server? Any CORS constraints?
- Are there specific compliance or content moderation requirements for default templates?
- Should the web app support authenticated write operations in v1, or read-only browsing only?

## 14. Developer Workflow (initial)
- Rust: `cargo fmt && cargo clippy && cargo test`
- Web: `npm run dev` (apps/web), `npm run build && next export`
- Desktop: `npm run tauri dev`
- Host: `relay host start --root ./host --port 8080`

## 15. Glossary
- Host mode: local server that serves repos and static site
- Web mode: browser-only, using WASM and HTTP to a host peer
- Interface: `.relay/interface.md` describing UI content and behavior hints
