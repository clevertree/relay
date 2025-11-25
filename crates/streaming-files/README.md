Streaming Files (Relay)

Shared Rust crate for managing streamed media downloads (torrents and, later, IPFS) for the Relay desktop client and server.

Features
- Backend-agnostic torrent client adapters: qBittorrent (Web API) and Transmission (RPC)
- Persistent per-device configuration: download folder, autoplay, thresholds, backend prefs, endpoints
- Normalized torrent status and file listings
- Playback decision logic based on configurable buffer thresholds (play while downloading)
- Optional UI prompt traits for desktop (Tauri) integration
- Playback via the OS default app (system-open)

Crate features
- client: enables UI-related traits/helpers (prompts) used by the desktop client
- server: keeps the crate headless (no UI prompts); intended for future server mirroring

Environment variables (defaults)
- qBittorrent: RELAY_QBT_HOST=127.0.0.1, RELAY_QBT_PORT=8080, RELAY_QBT_BASE=/, RELAY_QBT_USER (opt), RELAY_QBT_PASS (opt), RELAY_QBT_BYPASS_LOCALHOST=true
- Transmission: RELAY_TR_HOST=127.0.0.1, RELAY_TR_PORT=9091, RELAY_TR_PATH=/transmission/rpc, RELAY_TR_USER (opt), RELAY_TR_PASS (opt)
- Streaming: RELAY_STREAM_DOWNLOAD_DIR (optional initial download directory suggestion)

Persistent config (streaming.json)
- Location via directories crate:
  - Windows: %APPDATA%/relay/streaming.json
  - macOS: ~/Library/Application Support/relay/streaming.json
  - Linux: $XDG_CONFIG_HOME/relay/streaming.json
- Schema (v4):
  - download_dir
  - auto_play_confirmed (per-device autoplay consent)
  - seeding_default
  - auto_open_player_on_allow (default true)
  - play_min_first_bytes_mb (default 16)
  - play_min_total_mb (default 64)
  - play_min_total_percent (default 1)
  - resume_poll_interval_sec (default 5)
  - resume_timeout_min (default 30)
  - preferred_backend (auto|qbt|transmission)
  - playback_target (auto|system) — default system
  - optional endpoint overrides (qbt_host, qbt_port, qbt_base, tr_host, tr_port, tr_path)
  - torrents {}
- Migration: older `config_version` values are updated on load

Selected API
- StreamingService::new() and ::new_auto()
- add_magnet(), get_status(), list_files(), set_seeding()
- request_play() (client feature), get_or_prompt_download_dir() (client feature)
- get_config(), apply_config_patch()
- TorrentClient trait with qBittorrent and Transmission implementations

Playback thresholds
- Play when first N bytes are available (play_min_first_bytes_mb), OR
- Total downloaded >= min(play_min_total_mb, play_min_total_percent% of file size)
- Helper: `playback::is_playable_by_thresholds` (unit tested)
- Media detection by extension: video (mp4, mkv, mov, avi, webm, m4v, mpg, mpeg, ts, m2ts, mts, flv, wmv) and audio (mp3, aac, flac, ogg, wav). Actual playback depends on codecs/platform.

Development
- Run tests: cargo test -p streaming-files
- Lint: cargo clippy -p streaming-files -- -D warnings

Troubleshooting
- qBittorrent: enable WebUI on http://127.0.0.1:8080; bypass auth for 127.0.0.1 only in development
- Transmission: RPC at http://127.0.0.1:9091/transmission/rpc
- Check firewall/ports
- Verify valid magnet (starts with magnet:? and includes btih)
- If system-open fails: ensure the OS has a default app associated with the media type (e.g., install VLC)

License
- MIT OR Apache-2.0
