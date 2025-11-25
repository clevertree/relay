Relay Client (Rust Native)

Overview
Desktop client that connects to the Relay Tracker to discover master peers and opens Repository tabs to interact with Relay server repositories.

Tech stack (rust_native)
- UI: eframe/egui (pure Rust, hardware accelerated)
- HTTP: reqwest + rustls
- Async: tokio
- Logs: tracing + daily file rotation
- File dialogs: rfd
- Open with OS app: open

Current scope (v0)
- Home: connect to tracker, list recent master peer sockets, connect to a socket (opens a Repository tab).
- Repository: shows the repository URL and provides actions (open in default browser, copy URL, refresh placeholder).
- Settings: edit tracker URL, view app directories, open logs folder, test media playback handlers.
- Console: bottom panel that displays logs; accepts simple commands (help, peers, open <url>, clear).

Planned next (follow-up)
- Embedded webview for Repository rendering (via Wry) instead of external browser.
- Torrent/IPFS management UI integrating `streaming-files` with qBittorrent/Transmission RPC.
- Internal fullscreen media player (libmpv/gstreamer) with subtitle support.
- OS file associations installer to make Relay Client the default media player.

Tracker API reference (from apps/tracker)
- GET /api/peers → returns latest peers: `[ { id, socket, updatedAt } ]`
- POST /api/peers/upsert with JSON body `{ socket }` → upserts by unique socket and returns `{ id, socket, updatedAt }`

Configuration
- Environment variable `RELAY_TRACKER_URL` sets the default tracker, defaults to `https://relaynet.online`.
- Settings are persisted per-user under the OS-specific config dir.

Build & Run
- From repo root: `cargo run -p relay-client`
- First launch creates config and logs under:
  - Windows: `%LOCALAPPDATA%/Relay/RelayClient/`
  - macOS: `~/Library/Application Support/online.Relay.RelayClient/`
  - Linux: `~/.local/share/Relay/RelayClient/`

UI Guide
- Home: enter or select a socket and press Connect. Click Refresh peers to fetch from the tracker.
- Repository: actions to open in browser, copy URL, and a placeholder refresh.
- Settings: change tracker URL, save; test playback with two buttons.
- Console: type `help`, `peers`, `open https://...`, `clear`.

Media playback
- Open via OS default app: implemented using the `open` crate. From Settings, choose a file and open.
- Internal fullscreen player (with subtitles): available when building with the `internal_player` feature. Implemented by launching the `mpv` player in fullscreen with OSC and default key bindings. Sidecar subtitles (`.srt`, `.ass`, `.vtt`, `.sub`) next to the media are auto‑detected and loaded.
- Making Relay Client the OS default player (summary):
- Making Relay Client the OS default player (summary):
  - Windows: installer or registry entries to associate extensions (e.g., .mp4, .mkv) to `relay-client.exe` with `"%1"` arg.
  - macOS: bundle with `Info.plist` `CFBundleDocumentTypes`; register as handler for desired UTIs.
  - Linux: ship a `.desktop` file and MIME associations; update `mimeapps.list`.
  Detailed steps will be added when packaging is introduced.

 Enabling and testing the internal player
 - Install `mpv` and ensure the `mpv` executable is on your system PATH:
   - Windows: install from https://sourceforge.net/projects/mpv-player-windows/ or `scoop install mpv`.
   - macOS: `brew install mpv`.
   - Linux: `apt install mpv` / `dnf install mpv` / `pacman -S mpv`.
 - Build and run with the feature:
   - From repo root: `cargo run -p relay-client --features internal_player`
 - In the app, go to Settings → Media playback → "Choose file and Try Internal Fullscreen".
   - Optional: place a subtitle file next to the media with the same base name (e.g., `movie.mkv` + `movie.srt`). It will be loaded automatically.

Debug logging
- All UI actions and network calls are logged via `tracing` to a daily-rotated file and echoed in the in-app Console.
- Logs directory can be opened from Settings.

Notes
- Mobile support is out of scope in v0; desktop platforms (Windows/macOS/Linux) are targeted.