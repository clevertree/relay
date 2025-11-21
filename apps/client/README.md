Relay Client (Tauri + React + TypeScript + Tailwind)

Purpose
Desktop client that connects to the tracker to discover master peers and opens RepositoryBrowser tabs to interact with Relay servers.

Screens
- Home: Connect to tracker (defaults to https://relaynet.online), list recent master peer sockets, Connect button opens a RepositoryBrowser tab.
- RepositoryBrowser: URL path input (default /index.md), branch dropdown (default main), search field (POST /query), Markdown render for .md files, auto reload on path change.
- NavBar: Home, Settings, list of open repositories (closeable).

Dev
pnpm install
pnpm dev        # Vite dev server
pnpm tauri dev  # Tauri desktop

Config
- Tracker base: env VITE_TRACKER_URL (default https://relaynet.online)
