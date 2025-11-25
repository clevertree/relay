Relay WebExtension Client

Overview
- Cross‑browser extension (Chrome/Edge/Opera/Brave/Firefox) that connects to the Relay Tracker, remembers recently viewed repository sockets, and opens a selected repo in a new tab.
- Optional integrations: qBittorrent (WebUI) and Transmission (RPC) health checks and actions (future).
- Downloads are handled via the browser Downloads API; after completion the extension can open the file with the OS default video app using the Downloads API (supported for files downloaded by the extension).

Key Features (v0)
- Popup UI with MRU dropdown of recent repository sockets and an input to add a new one.
- Fetch latest peers from a tracker (default https://relaynet.online) and open a selected repo in a new tab.
- Options page to configure tracker URL and optional local torrent backends; request host permissions; enable downloads permission and "open after download" preference.

Limits
- The extension cannot bypass TLS errors on self‑signed certs. Use HTTP on localhost or install a valid certificate.
- Cross‑browser file writes are limited to the Downloads API. Arbitrary filesystem access is not available.
- Opening with OS default app is guaranteed only for files downloaded by this extension via the Downloads API (using downloads.open). Arbitrary local files require a native helper (out of scope in v0).

Develop
1. Load unpacked extension:
   - Chromium: open chrome://extensions → Enable Developer mode → Load unpacked → select apps/extension
   - Firefox: open about:debugging#/runtime/this-firefox → Load Temporary Add-on… → select apps/extension/manifest.json
2. Open the popup via the toolbar button, or open the Options page from the extension’s details.

Build
- No build step required for v0 (plain JS/HTML). If bundling is later desired, wire it in a separate step.
