# Relay - Decentralized FileShare

A decentralized content distribution platform built on git protocl,featuring IPFS content sharing, and dual-mode client support (desktop + web).

## Overview

Relay enables community-driven content repositories (movies, TV shows, games, voting) with distributed file sharing via IPFS. The platform features:

- **Dual-mode clients**: Desktop (Tauri) and Web (static export + WebAssembly)
- **Shared core library**: `relay-core` powers both CLI and UI clients
- **Host mode**: Self-hosted git repository + HTTP static server
- **Web mode**: Browser-only mode with WebAssembly and OPFS storage
- **Docker support**: Containerized host mode deployment

## Quick Start

### Prerequisites

- Rust 1.70+ and Cargo
- Node.js 18+ and npm
- Docker (optional, for containerized deployment)

## Architecture Overview

### Project Structure
 TBD 
### Core Components

- **relay-core**: Shared Rust library with crypto, IPFS, blockchain state management
- **relay-cli**: Command-line interface for host mode operations
- **relay-wasm**: WebAssembly build for browser-only mode
- **UI (Next.js)**: Universal frontend (static export for Tauri + web)
- **Tauri**: Desktop wrapper that embeds Next.js and provides native APIs
- **Docker**: Container for running CLI in host mode with exposed ports

Shared Configuration
--------------------
The CLI and UI share a single on-disk configuration file (`~/.relay/config.toml` by default). Configuration options include the RPC endpoint, default wallet, and data path. The UI provides a settings page to edit configuration values; changes are saved to disk immediately and update the CLI behavior (for example, the SQLite state DB location). 

Default Client Behavior
-----------------------
By default the client does not download git repository data. Browsing channels initially connects to a master peer server (a host-mode client running the Rust static http frontend). A local git clone is created only when a user explicitly chooses to download a channel repository via the UI or the CLI. This keeps the default client lightweight and network-driven while allowing offline/offloading via optional local storage when requested.

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
Blockchain IPFS Hash → DHT Search → Peer Connection → Download/Stream
```

### 4. Repository Schema + Browser UI

- Defined by files in git repo which are automatically downloaded when browsing: 
-- Browser interface text, css and content defined by `.relay/interface.md`
-- File structure to define each Repository `.relay/schema.yaml`
-- `relay-core` provides git services push/pull/merge and uses `prereceive hook` to verify each commit against the schema rules. Any commits that violate rules are rejected by the git server.
- Large content viewing area with real-time search
- Repository browser works with any git repository in host mode. In default non-host mode, a client needs to make an HTTP call to a master peer node in order to download repository files. 
- Specialized UIs (e.g., Movie Browser) defined in repository interface. 


## Technology Stack

### Backend (Rust)
- **relay-core** - Shared library (crypto, IPFS, blockchain state)
- **relay-cli** - Command-line interface
- **relay-wasm** - WebAssembly bindings for browser
- **Tokio** - Async runtime
- **Tauri** - Desktop framework
- **WebIPFS** - IPFS protocol implementation
- **SQLite** - Local blockchain state storage

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
TBD

## Use Cases

### Use Case 1: Initiate new Repository
1. Client initializes a new repository 'movies' in <appdir>/repos/<repo-name> using `movies` template which creates default repo files.
2. 

### Use Case 1: Look up channels for a wallet/account id
1. Connect to RPC server (testnet/mainnet, defaulting to testnet)
2. Once connected list the known wallets associated with the server in the same UI. 
These are wallet ids where the public key is known, including local wallets. 
Distinguish between local and remote wallets (without phrases/keys). 
3. Clicking on 'Open' opens the WalletBrowser which lists the wallet's channels which are defined by contracts.
TBD: determine best way of listing contracts per wallet. 
4. Each channel has a 'Browse' button which opens the ChannelBrowser for that server/wallet/channel==contract
5. The channel browser provides a default UI for browsing transactions based on a primary key defined by the wallet.
All entries are listed by primary key with stat columns defined by the contract. There is a search feature. 

### Use Case 2: Contribute Content
1. Generate/import NEAR wallet identity for testnet
2. Connect to NEAR RPC (testnet or mainnet)
3. Navigate to Movies channel. Click option to download entire blockchain offline.
3b. Download entire movie blockchain and store the state in sqlite.
4. Create new movie entry with metadata and IPFS hash
5. Submit modification requests to fix errors via blockchain transaction
6. Rate movies with 1-5 star reviews via blockchain transaction
7. Validate entry was made on blockchain.

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
3. **Add Tauri command** (`ui/src-tauri/src/main.rs`)
4. **Add React component** (`ui/src/components/`)
5. **Add API route** (if needed in host mode: `ui/src/pages/api/`)
6. **Write tests** (Rust unit, React component, Cypress E2E)

### Key Conventions

- **Naming**: Use `snake_case` for Rust, `camelCase` for TypeScript/React
- **Error handling**: Always use `Result<T, E>` in Rust, try/catch in TypeScript
- **Async patterns**: Use `async/await` in both Rust and TypeScript
- **State management**: Zustand for React, no global mutable state in Rust
- **Documentation**: Doc comments for all public APIs (`///` in Rust, JSDoc in TS)


## Testing Strategy


### Rust Tests

```bash
# Test all workspace crates
cargo test --workspace

# Test specific crate
cargo test -p relay-core

# Test with logging
RUST_LOG=debug cargo test

# Integration tests
cargo test --test '*'
```

### Frontend Tests

```bash
# Component tests (Vitest)
npm run test:unit

# Component tests (Cypress)
npm run test:component

# E2E tests (Cypress)
npm run test:e2e

# All tests
npm test
```

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
- [ ] Real-time blockchain event subscriptions
- [ ] Transactions monitor improvements
- [ ] Performance optimizations

### Phase 4: Future Enhancements 🔮
- [ ] WebRTC peer-to-peer communication
- [ ] Multi-signature transaction support
- [ ] Smart contract editor and deployment tools
- [ ] Mobile apps (React Native)
- [ ] Hardware wallet support (Ledger, Trezor)
- [ ] Analytics dashboard
- [ ] Governance/voting mechanisms
- [ ] Channel auditing and compliance tools

### Additional Resources

- [NEAR Protocol Documentation](https://docs.near.org/)
- [Tauri Documentation](https://tauri.app/v1/guides/)
- [Next.js Documentation](https://nextjs.org/docs)
- [IPFS Documentation](https://docs.ipfs.tech/)
