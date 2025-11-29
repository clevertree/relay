Relay Client (Valdi) - Implementation Plan (Linux first)

Purpose
- Implement the Relay client UI using Valdi in Rust.
- Target Linux desktop first; extend to macOS/Windows and Android/iOS later.
- Use Valdi directly (no temporary stand-ins).

Environment (Linux)
- Rust stable via rustup.
- Add Valdi Rust dependency in apps/client-valdi/Cargo.toml (fill exact crate or git pin once confirmed in Linux env).
- Install Valdi prerequisites for Linux per Valdi docs (X11/Wayland, GL/Vulkan, any webview deps if required).
- Environment variables: RELAY_MASTER_PEER_LIST (semicolon-separated), RUST_LOG=info during development.

Repository structure
- crates/relay-client-core (core logic already scaffolded)
  - config.rs: env/args
  - peers.rs: peer probing (HTTPS/Git/IPFS + last update)
  - remotes.rs: OPTIONS/GET/QUERY helpers
  - plugins.rs: plugin registry and descriptors
  - scripts.rs: JS engine abstraction
  - md.rs: markdown -> intermediate UI tree
- apps/client-valdi (Valdi UI app)
  - src/app.rs: Valdi app bootstrap and global app state
  - src/platform/linux.rs: Valdi window and event loop (Linux first)
  - src/ui/
    - peers.rs: Peers health view (grid with auto-refresh)
    - repo_tab.rs: Repo Browser tab shell per peer (closable)
    - md_renderer.rs: render core::md tree with Valdi widgets
    - scripts_console.rs: per-tab script console
    - plugins/
      - default_native.rs: Native Repo Browser (Visit/Search, GET/QUERY)
      - webview.rs: Built-in Webview plugin + restricted bridge
      - declarative_native.rs: Declarative v1 native renderer
  - src/bridge/webview_bridge.rs: restricted JS bridge for repo web plugins

Requirements mapping
1. Peer health view
   - Probe HTTPS 443 (TCP + HEAD / latency median of 3), Git 9418 (TCP), SSH 22 (optional), IPFS API 5001 (POST /api/v0/version latency median), IPFS Gateway 8080 (HEAD /ipfs/), IPFS Swarm 4001 (TCP).
   - Fetch last update via OPTIONS / and take max timestamp from branchHeads when available.
2. Repo Browser tabs
   - Clicking a peer opens a closable tab bound to https://{host}.
   - On tab mount, call OPTIONS and parse branches, repos, branchHeads and relay (embedded relay.yaml) including interface.<os>.*.
3. Script runtime
   - Sandbox JS engine (QuickJS or Boa) with fetch to selected peer and timers only. No filesystem/process.
4. Default Repo Browser plugin (native)
   - Top bar path input (select-all on focus). Button disabled until changed.
   - Visit (GET) when input looks like a path or URL. If directory, imply index.md.
   - Search (QUERY) otherwise: render results grid with View action to navigate to meta_dir/index.md.
5. Results grid
   - Columns inferred from returned fields; View button per row.
6. Markdown renderer
   - Use pulldown-cmark to intermediate UI tree; render via Valdi widgets.
   - Limited inline HTML; custom tag registry to support tags like <video url="..."/>.
   - Directory path implies index.md.
7. Docs
   - Document plugin discovery and OS-specific loading; default to webview when no OS-specific plugin is provided.
8. Build & packaging
   - Desktop artifacts for Linux first (AppImage + tar.gz). Extend to macOS/Windows later.
9. Archive old client docs

Milestones and acceptance criteria
- M1: Valdi window opens on Linux; Peers grid shows HTTPS/Git/IPFS status and median latencies; auto-refresh ~10s; clicking opens a tab shell.
- M2: Plugin discovery and switcher (priority: Repo -> Native -> Webview) with per-session persistence per (peer, repo).
- M3: Repo webview plugin loads with restricted bridge exposing relay.fetch/state/postMessage only.
- M4: Declarative native plugin v1: manifest loads; markdown and grid render; row View navigates to index.md.
- M5: Default native Repo Browser: Visit/Search, GET/QUERY, results grid with View.
- M6: Markdown renderer supports custom tags such as <video url="..."/>.
- M7: Packaging and CI for Linux; docs updated; legacy client docs archived.

Task checklist
- T0: Add Valdi dependency and bootstrap a Linux window (apps/client-valdi/src/app.rs and platform/linux.rs).
- T1: Wire peer probing background task; render Peers grid with auto and manual refresh.
- T2: Implement tab shell and OPTIONS info sidebar per tab.
- T3: Plugin registry and toolbar switcher (RepoProvided, BuiltInDefault, BuiltInWebview) with correct priority.
- T4: Webview plugin and restricted bridge implementation.
- T5: Declarative plugin loader (GET plugin.manifest.json) and native renderer for markdown/grid/detail-json/action; integrity check by hash and caching with ETag/Last-Modified.
- T6: Default native Repo Browser (Visit/Search, GET/QUERY, results grid with View).
- T7: Markdown renderer with custom tags and asset resolution.
- T8: Script runtime and console UI (fetch-only; timeouts and size caps).
- T9: Packaging and CI; docs update and archive legacy client docs.

Open items
- Exact Valdi crate spec (name/version or pinned git rev) and Linux system prerequisites.
- Styling preferences for Peers grid and tab chrome.
- Any authentication headers required for OPTIONS/GET/QUERY.

Definition of done for first UI test
- Linux Valdi window opens.
- Peers view shows statuses and latencies and auto-refreshes.
- Clicking a peer opens a closable tab with OPTIONS info (branches, repos, branchHeads summary).
- Plugin selector lists Repo (if discovered), Default (native), and Webview; switching updates tab state.

Last updated: 2025-11-29