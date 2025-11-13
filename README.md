# Relay - Decentralized Browsable Repository

A decentralized content distribution platform built on git protocol, 
featuring IPFS content sharing, and dual-mode client support (desktop + web).

## Overview

Relay enables community-driven content repositories (movies, TV shows, games, voting) 
with distributed file sharing via IPFS. The platform features:

- **Dual-mode clients**: Desktop (Tauri) and Web (static export + WebAssembly)
- **Shared core library**: `relay-core` powers both CLI and UI clients
- **Host mode**: Self-hosted git repository + HTTP static server
- **Web mode**: Browser-only mode with WebAssembly and OPFS storage
- **Docker support**: Containerized host mode deployment

## Quick Start

Until the codebase is bootstrapped, see `docs/PLAN.md` for the full implementation blueprint and milestones.

After the initial scaffold (Milestone M1), you will be able to:

1. Clone the repo and install prerequisites (Rust 1.91+, Node 20+).
2. Build Rust workspace: `cargo build`.
3. Install JS deps and start dev pipeline (Turborepo): `pnpm install && pnpm dev`.
4. Create a sample repository: `cargo run -p relay-cli -- init --repo movies --template movies --path ./host/repos`.
5. Start host mode: `cargo run -p relay-cli -- host start --port 8080 --root ./host` (also starts the git protocol server on port 9418 by default).
6. Clone from another client via git protocol: `cargo run -p relay-cli -- git clone git://localhost:9418/movies ./movies`.
7. Open the UI at `http://localhost:8080` or use the Tauri desktop app after build.

Note: Commands are indicative and will be available as milestones are completed.

### Prerequisites

- Rust 1.91+ and Cargo
- Node.js 20+ and npm
- Docker (optional, for containerized deployment)

## Architecture Overview

### Project Structure

See `docs/PLAN.md` for the full target layout. High-level overview:

- Rust workspace in `crates/`: `relay-core`, `relay-cli`, `relay-wasm`
- Apps in `apps/`: `web` (Next.js), `desktop` (Tauri)
- Runtime host data in `host/`: `repos/`, `static/`, `hooks/`
- Templates in `template/` (e.g., `template/movies/.relay/schema.yaml`)
- Docs in `docs/` (this plan and future architecture docs)
- Scripts in `scripts/` for dev/CI
### Core Components

- **relay-core**: Shared Rust library with crypto, IPFS, git protocol server/client (via mygit, default port 9418, feature-gated), and HTTP server/client.
- **relay-cli**: Command-line interface for host mode operations
- **relay-wasm**: WebAssembly build for browser-only mode
- **UI (Next.js)**: Universal frontend (static export for Tauri + web)
- **Tauri**: Desktop wrapper that embeds Next.js and provides native APIs
- **Docker**: Container for running CLI in host mode with exposed ports

Shared Configuration
--------------------
The CLI and UI share a single on-disk configuration file (`~/.relay/config.toml` by default).
Configuration options include the Default master node endpoint `node1.relaynet.online` and default data path. 
The UI provides a settings page to edit configuration values; config changes are saved to disk immediately and affect the CLI behavior 

Default Client Behavior
-----------------------
By default, the client does not download git repository data. 
Browsing channels initially connects to a master peer server 
(a host-mode client running the Rust static http frontend). 
A local git clone is created only when a user explicitly chooses to 
download a channel repository via the UI or the CLI. 
This keeps the default client lightweight and network-driven
while allowing offline/offloading via optional local storage when requested.

## Key Features

### 1. Dual-Mode Operation

**Desktop Mode (Tauri)**
- Native desktop application with full filesystem access
- Embedded Next.js static export running locally
- Direct Rust library calls via Tauri commands
- Full feature set: key management, IPFS, git operations

**Web Mode (Browser)**
- Static site deployment (Vercel, etc.)
- WebAssembly-powered core functionality
- OPFS/IndexedDB for storage
- Limited feature set (no native filesystem access)

**Host Mode**
- Self-hosted git repository
- Serves Next.js static files
- Can run in CLI, desktop, or Docker container

**Default Repositories:**
- `movies` - Community-contributed movie database with IPFS hashes
- *(Extensible)* - TV shows, games, voting, custom repositories

### 3. Distributed File Sharing (IPFS)

- P2P file distribution via WebIPFS protocol
- DHT peer discovery and gossip protocol
- Download progress tracking with streaming support
- Pause/resume functionality for large files
- Multi-file IPFS support

**Flow:**
```
IPFS Hash → DHT Search → Peer Connection → Download/Stream
```

### 4. Repository Schema + Browser UI
- Defined by files in git repo which are automatically downloaded when browsing: 
-- Browser interface text, css and content defined by `.relay/interface.md`
-- File structure to define each Repository `.relay/schema.yaml`
-- `relay-core` provides git services push/pull/merge and uses `prereceive hook` to verify each commit against the schema rules. Any commits that violate rules are rejected by the git server.
- Large content viewing area with real-time search
- Repository browser works with any git repository in host mode. In default non-host mode, a client needs to make an HTTP call to a master peer node in order to download repository files. 
- Specialized UIs (e.g., Movie Browser) defined in repository interface. 
- `relay-core` provides an http client that requests files from a master peer server following the schema rules.
- By default, the only files that a repo browser are allowed to load within it's own UI are:
   .md, .css, .png, .jpg, .jpeg, .gif, .svg, .json, .wasm, .html, .txt, .xml, .pdf
- Client UI is never allowed to load any insecure files from the host directory, like javascript.
- When a repo approves a commit and merges, it pushes the changes to each of the other master peer servers.

### 5. Host file structure
- clients in 'host' mode host a static file http server on a port defined in config
- Client 'host' mode static http server hosts all files in <app dir>/host/* including repository files
- Clients in 'web' mode connect to the same server via http GET call, and can cache requests. 

## Technology Stack

### Backend (Rust)
- **relay-core** - Shared library (crypto, IPFS, repository state)
- **relay-cli** - Command-line interface
- **relay-wasm** - WebAssembly bindings for browser
- **Tokio** - Async runtime
- **Tauri** - Desktop framework
- **WebIPFS** - IPFS protocol implementation

### Frontend (Next.js + TypeScript + MUI)
- **Next.js 14** - Framework with static export
- **React 18** - UI library
- **TypeScript** - Type safety
- **Material UI** - Styling and components
- **Zustand** - State management
- **React Hook Form** - Form handling
- **Axios** - HTTP client
- **Next.js API Routes** - Backend API (host mode only)

### Testing & Quality
- **Cypress** - E2E and component testing
- **Vitest** - Unit testing (Rust-compatible alternative to Jest)
- **@testing-library/react** - Component testing utilities
- **cargo test** - Rust unit and integration tests

### DevOps
- **Docker** - Containerization for host mode
- **GitHub Actions** - CI/CD pipeline
- **Vercel/Netlify** - Static web deployment (web mode)


## Getting Started

### Development Workflow

Refer to `docs/PLAN.md` §14 for day-to-day commands. Summary:

- Rust
  - Format/lint/test: `cargo fmt && cargo clippy -- -D warnings && cargo test`
- Web (Next.js)
  - Dev: `cd apps/web && npm install && npm run dev`
  - Build + export: `npm run build && npx next export`
- Desktop (Tauri)
  - Dev: `cd apps/desktop && npm install && npm run tauri dev`
- Host mode
  - Start server: `cargo run -p relay-cli -- host start --port 8080 --root ./host`
- Git operations (mygit protocol)
  - Clone: `cargo run -p relay-cli -- git clone git://localhost:9418/movies ./movies`
  - Fetch: `cargo run -p relay-cli -- git fetch git://localhost:9418/movies`
  - Pull: `cargo run -p relay-cli -- git pull git://localhost:9418/movies master`
  - Push: `cargo run -p relay-cli -- git push git://localhost:9418/movies master`
- Templates
  - Init sample repo: `cargo run -p relay-cli -- init --repo movies --template movies --path ./host/repos`

## Use Cases

### Use Case 1: Initiate new Repository
1. Client initializes a new repository 'movies' in <appdir>/host/repos/<repo-name> using `movies` template which creates default repo files.
2. Client adds a movie entry with metadata and IPFS hash and attempts to commit the change.
3. Client receives error message due to missing schema rules and the commit is rejected.
4. Client corrects the schema and commits the change which is accepted by the git server.
5. Client initiates 'host' mode, which runs the static http server in the background.
6. 2nd Client spins up in a separate directory and connects to the socket of the first client.
7. 2nd Client browses first client which shows the host directory, and a list of repos. 
8. 2nd Client browses /repos/movies and sees the new movie entry.

## Development Guidelines

### Code Organization Principles

1. **Shared Library First**: All core business logic belongs in `relay-core`
2. **CLI and UI are thin clients**: Both call shared library functions
3. **Web-only vs normal**: `relay-core` is built as a rust executable binary (normal) and as a webasm library (web-only mode)
4. **API-first design**: Host mode APIs should be RESTful and well-documented
5. **Test everything**: Unit tests (Rust), component tests (React), E2E tests (Cypress)

### Adding a New Feature

1. **Add to shared library** (`crates/relay-core/src/`)
2. **Add CLI command** (`crates/relay-cli/src/main.rs`)
3. **Write tests** (Rust unit, React component, Cypress E2E)

### Key Conventions

- **Naming**: Use `camelCase` for TypeScript/React
- **Error handling**: Always use `Result<T, E>` in Rust, try/catch in TypeScript
- **Async patterns**: Use `async/await` in both Rust and TypeScript
- **State management**: Zustand for React, no global mutable state in Rust
- **Documentation**: Doc comments for all public APIs (`///` in Rust, JSDoc in TS)


## Testing Strategy

TBD

### Desktop Application Tests

```bash
# WebdriverIO tests for Tauri
npm run test:tauri
```

### Test Coverage

- **Unit tests**: All public functions in `relay-core` and `relay-cli`
- **Component tests**: All React components with user interactions
- **E2E tests**: Critical user workflows (key generation, channel browsing, content submission)
- **Integration tests**: CLI commands, Tauri commands, API routes


### Pull Request Checklist

- [ ] All tests pass (`cargo test` and `npm test`)
- [ ] No clippy warnings (`cargo clippy -- -D warnings`)
- [ ] Code formatted (`cargo fmt` and `npm run format`)
- [ ] Documentation updated
- [ ] Changelog entry added (if applicable)
- [ ] No breaking changes (or clearly documented)

### Review Process

1. Automated CI checks must pass
2. Code review by at least one maintainer
3. All discussions resolved
4. Squash merge into main branch


### Planned Security Enhancements

- OS keychain integration (macOS Keychain, Windows Credential Manager, Linux Secret Service)
- Hardware wallet support
- Multi-signature transactions
- Encrypted local database
- Security audit and penetration testing



## Roadmap

### Phase 1: Core Infrastructure ✅
- [ ] NEAR Protocol integration
- [ ] Movie Repository Schema-enforced
- [ ] Basic CLI implementation
- [ ] Web-only UI with Tauri
- [ ] Desktop UI with Tauri

### Phase 2: Current Development 🚧
- [ ] Complete Next.js static export
- [ ] WebAssembly build for web mode
- [ ] Docker containerization
- [ ] Comprehensive test suite (Cypress, Vitest, WebdriverIO)
- [ ] OPFS/IndexedDB storage for web mode
- [ ] CI/CD pipeline

### Phase 3: Enhanced Features 📋
- [ ] OS keychain integration for secure key storage
- [ ] Additional channels (TV shows, games, voting)
- [ ] Advanced IPFS features (streaming, resume)
- [ ] Performance optimizations

### Phase 4: Future Enhancements 🔮
- [ ] WebRTC peer-to-peer communication
- [ ] Mobile apps (React Native)
- [ ] Analytics dashboard
- [ ] Governance/voting mechanisms

### Additional Resources

- [Tauri Documentation](https://tauri.app/v1/guides/)
- [Next.js Documentation](https://nextjs.org/docs)
- [IPFS Documentation](https://docs.ipfs.tech/)



## Host Repositories: Non-bare, Checked-out Working Trees (Git Interop)

- Repositories served by host mode live under `host/repos/<name>` as non-bare repositories with a checked-out working tree on the default branch (master unless configured).
- There is no `.git` suffix in the served path. Example remote URL: `git://<host>:9418/movies` maps to `host/repos/movies`.
- The HTTP static server serves files directly from these checked-out working trees so that repository contents are fully accessible to the web UI.
- The git server MUST support standard Git operations against these working trees, including `clone`, `fetch`, `pull`, and `push`, while keeping the working tree updated appropriately (e.g., fast-forward pulls).
- Full Git protocol interoperability is a priority: any standard Git client should be able to operate against the server using the `git://` protocol.
- Validation on push is blockchain-like: a pre-receive–style validation checks the entire set of incoming commits against the repository schema. If any commit violates the schema rules, the whole push is rejected. This ensures an append-only, validated history.
