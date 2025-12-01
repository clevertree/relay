Relay Client (Flutter) – Implementation Plan (Mobile + Desktop)

Purpose
- Implement the Relay client UI using Flutter for a single codebase targeting mobile (Android/iOS) and desktop (Linux/macOS/Windows).
- Reuse existing core logic from `crates/relay-client-core` via Rust <-> Dart FFI to keep behavior consistent across platforms.
- Provide UX features adapted to Flutter widgets and plugins.

Target platforms and phasing
- Phase 1 (Desktop-first): Linux desktop as the initial bring-up platform; then macOS and Windows.
- Phase 2 (Mobile): Android first, then iOS.

Environment
- Flutter stable (>= 3.24) with Impeller/Vulkan/Metal backends as applicable.
- Dart >= 3.
- Rust stable via rustup for building the shared Rust core.
- FFI bridge: flutter_rust_bridge (FRB) v2 or Dart FFI + cbindgen; prefer FRB v2 for productivity and multi-target builds.
- System deps per platform:
  - Linux: clang/llvm, CMake, GTK3 (for `flutter_linux`), OpenSSL (for Rust HTTP if needed), pkg-config.
  - macOS: Xcode, CocoaPods, Rust targets `aarch64-apple-darwin` and optionally `x86_64-apple-darwin`.
  - Windows: Visual Studio Build Tools (MSVC), Rust `x86_64-pc-windows-msvc`.
  - Android: Android SDK/NDK (r26+), Rust `aarch64-linux-android`, `armv7-linux-androideabi`, `x86_64-linux-android` via cargo-ndk.
  - iOS: Xcode/iOS toolchain, Rust `aarch64-apple-ios` (and `x86_64-apple-ios` for simulator if needed).
- Environment variables: `RELAY_MASTER_PEER_LIST` (semicolon-separated), `RUST_LOG=info` during development.

Repository structure
- crates/relay-client-core (existing Rust core logic)
  - `config.rs`: env/args
  - `peers.rs`: peer probing (HTTPS/Git/IPFS + last update)
  - `remotes.rs`: OPTIONS/GET/QUERY helpers
  - `plugins.rs`: plugin registry and descriptors
  - `scripts.rs`: JS engine abstraction
  - `md.rs`: markdown -> intermediate UI tree
- apps/client-flutter (new Flutter app)
  - `pubspec.yaml`: Flutter/Dart deps and FRB codegen configuration
  - `lib/`
    - `main.dart`: app bootstrap, routing, global app state provider
    - `state/`: Riverpod/Provider/BLoC stores for peers, tabs, plugins
    - `ui/`
      - `peers_view.dart`: Peers health grid (auto-refresh)
      - `repo_tab.dart`: Repo Browser per-peer tab shell (closable)
      - `md_renderer.dart`: render core `md` tree into Flutter widgets
      - `scripts_console.dart`: per-tab script console
      - `plugins/`
        - `default_native.dart`: Native Repo Browser (Visit/Search, GET/QUERY)
        - `webview.dart`: Built-in WebView plugin + restricted bridge
        - `declarative_native.dart`: Declarative v1 native renderer
    - `bridge/`
      - `relay_core.dart`: FRB/Dart FFI surface to Rust core
      - `webview_bridge.dart`: restricted JS bridge for repo web plugins
  - `rust/` (generated or maintained FRB crate wrapper around relay-client-core)
    - `Cargo.toml`: cdylib for multi-targets, depends on `relay-client-core`
    - `src/lib.rs`: FRB-exposed functions for peers/remotes/md/scripts
  - `android/`, `ios/`, `linux/`, `macos/`, `windows/` (Flutter platform folders)

Bridging strategy (Rust core <-> Flutter)
- Wrap select APIs from `relay-client-core` using flutter_rust_bridge:
  - Peers: start/stop background probe, subscribe to updates (streams).
  - Remotes: `options`, `get`, `query` with cancellation and timeouts.
  - Plugins model: list discovered plugins and descriptors.
  - Scripts: sandboxed JS evaluate with fetch limited to selected peer.
  - MD: parse markdown to an intermediate tree transferable to Dart (use JSON-like structs or FRB enums).
- Build cdylib for each platform and wire FRB codegen into Flutter build steps.

Requirements mapping (to Flutter)
1. Peer health view
   - Probe endpoints: HTTPS 443 (TCP + HEAD / latency median of 3), Git 9418 (TCP), SSH 22 (optional), IPFS API 5001 (POST /api/v0/version latency median), IPFS Gateway 8080 (HEAD /ipfs/), IPFS Swarm 4001 (TCP).
   - Fetch last update via `OPTIONS /` and take max timestamp from branchHeads when available.
   - UI: Flutter `DataTable`/`PaginatedDataTable` or responsive GridView with status chips; auto-refresh ~10s; manual refresh button.

2. Repo Browser tabs
   - Tap/click on a peer opens a closable tab bound to `https://{host}`.
   - On tab mount, call `OPTIONS` via Rust core and parse branches, repos, branchHeads, and embedded `relay.yaml` (interface.<os>.*) for plugin discovery.
   - UI: TabBarView for desktop and a bottom sheet/tab navigator for mobile; keep state per (peer, repo).

3. Script runtime
   - JS engine inside Rust (QuickJS/Boa) sandboxed; expose only `fetch` (peer-bound) and timers. No filesystem/process.
   - UI: simple console area with input and output, per tab.

4. Default Repo Browser plugin (native)
   - Top bar path input (select-all on focus). Action button disabled until changed.
   - Visit (GET) when input looks like a path/URL; if directory, imply `index.md`.
   - Search (QUERY) otherwise: results grid with View action to navigate to `meta_dir/index.md`.
   - UI: `TextField` + `FilledButton`; grid via `DataTable` or `GridView` depending on layout.

5. Results grid
   - Columns inferred from returned fields; View button per row.
   - Support pagination/virtualization for large result sets.

6. Markdown renderer
   - Option A: Convert Rust `md` intermediate tree to Dart models and render with custom Flutter widgets.
   - Option B: Use `flutter_markdown` for standard markdown + custom inline HTML via builders.
   - Support limited inline HTML; register custom tags such as `<video url="..."/>` → render with `video_player`/`chewie` or platform webview as fallback.
   - Directory path implies `index.md`.

7. Docs
   - Document plugin discovery and OS-specific loading; default to WebView when no OS-specific plugin is provided.
   - Document FFI build for each platform (targets, NDK, signing where applicable).

8. Build & packaging
   - Desktop: Flutter artifacts for Linux (AppImage + tar.gz), macOS (.app/.dmg), Windows (MSIX/ZIP).
   - Mobile: Android (APK/AAB), iOS (IPA/TestFlight).
   - CI: matrix builds using GitHub Actions; cache Rust + Flutter.

9. Archive old client docs
   - Migrate references to new Flutter client; keep Valdi doc archived for historical context.

Milestones and acceptance criteria
- M1 (Desktop bring-up): Flutter window opens on Linux; Peers grid shows HTTPS/Git/IPFS status and median latencies; auto-refresh ~10s; clicking opens a tab shell.
- M2: Plugin discovery and switcher (priority: RepoProvided -> Native -> WebView) with per-session persistence per (peer, repo).
- M3: Repo WebView plugin loads with restricted bridge exposing `relay.fetch/state/postMessage` only.
- M4: Declarative native plugin v1: manifest loads; markdown and grid render; row View navigates to `index.md`.
- M5: Default native Repo Browser: Visit/Search, GET/QUERY, results grid with View.
- M6: Markdown renderer supports custom tags such as `<video url="..."/>`.
- M7: Packaging and CI for Linux; docs updated; legacy client docs archived.
- M8 (Mobile bring-up): Android build runs peers view and opens repo tab; iOS simulator runs peers view.

Task checklist
- T0: Create `apps/client-flutter` Flutter app skeleton; add FRB and platform scaffolding.
- T1: Add Rust cdylib wrapper around `relay-client-core`; expose FRB APIs; wire Linux desktop build.
- T2: Peers probing background task from Rust; Dart stream subscription; render Peers grid with auto/manual refresh.
- T3: Implement tab shell and `OPTIONS` info sidebar per tab; persist selection state.
- T4: Plugin registry and toolbar switcher (RepoProvided, BuiltInDefault, BuiltInWebView) with correct priority.
- T5: WebView plugin and restricted JS bridge implementation (WebView: `webview_flutter` on mobile/desktop, `flutter_inappwebview` if needed for feature gaps).
- T6: Declarative plugin loader (`GET plugin.manifest.json`) and native renderer for markdown/grid/detail-json/action; integrity by hash and caching via ETag/Last-Modified.
- T7: Default native Repo Browser (Visit/Search, GET/QUERY, results grid with View); path bar UX polish.
- T8: Markdown renderer with custom tags and asset resolution; choose Option A or B and implement custom builders.
- T9: Script runtime UI (console) delegating to Rust JS engine; enforce timeouts and size caps.
- T10: Packaging and CI for Linux; then extend to macOS/Windows.
- T11: Android build (cargo-ndk integration) and basic QA on device/emulator; then iOS.
- T12: Docs update; archive legacy client docs.

Dependencies (Flutter pub)
- state management: `flutter_riverpod` or `provider` (choose one; default to Riverpod for streams)
- async: `rxdart` (optional), `stream_transform`
- UI: `go_router` or `beamer` (optional), `flutter_markdown`, `video_player`, `chewie`
- WebView: `webview_flutter` (primary), `flutter_inappwebview` (fallback)
- FFI: `flutter_rust_bridge`, `ffi`
- JSON: `freezed`, `json_serializable` (if modeling trees in Dart)

FFI build targets (Rust)
- Linux: `x86_64-unknown-linux-gnu`
- macOS: `aarch64-apple-darwin` (and optionally `x86_64-apple-darwin`)
- Windows: `x86_64-pc-windows-msvc`
- Android: `aarch64-linux-android`, `armv7-linux-androideabi`, `x86_64-linux-android`
- iOS: `aarch64-apple-ios` (and simulator as needed)

Security and sandboxing
- JS engine embedded in Rust remains sandboxed (no fs/process). Expose only peer-scoped fetch and timers via FRB.
- WebView JS <-> Dart bridge limits to `relay.fetch`, `relay.state` (read-only), `postMessage`. Validate origins per selected peer.

Performance & UX notes
- Use background isolates only if CPU-bound work emerges on Dart side; prefer doing heavy work in Rust.
- Debounce peer probes and UI updates; batch diff updates from FRB streams.
- Virtualize large tables; lazy-load images/assets referenced in markdown.

Open items
- Finalize FRB v2 vs bare FFI choice; prototype on Linux to confirm stability.
- Decide on state management (Riverpod vs BLoC) and navigation pattern for tabs on mobile.
- Styling preferences for Peers grid and tab chrome.
- Any authentication headers required for OPTIONS/GET/QUERY.
- Decide Markdown renderer approach (Rust tree vs flutter_markdown) based on feature parity needs.

Definition of do[PLAN.md](PLAN.md)ne for first UI test (Desktop/Linux)
- Flutter window opens.
- Peers view shows statuses and latencies and auto-refreshes.
- Clicking a peer opens a closable tab with `OPTIONS` info (branches, repos, branchHeads summary).
- Plugin selector lists Repo (if discovered), Default (native), and WebView; switching updates tab state.

Appendix: Developer quick start (Linux)
1) Install Flutter and Rust toolchains; run `flutter doctor`.
2) In `apps/client-flutter/rust`, run `cargo build` for host to validate core wrapper.
3) Run FRB codegen (configure in `pubspec.yaml` or `build.yaml`).
4) `flutter run -d linux` to launch the desktop app.

Last updated: 2025-11-29
