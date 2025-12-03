# Relay Client Web

Web client for Relay that provides a browser-based interface for discovering peers and browsing their repositories.

## Overview

This is a web client built with **Vite + React** that:

- Lists available Relay peers with their online/offline status
- Probes peer endpoints to measure latency and availability
- Opens multiple repository browser tabs
- Renders markdown files as HTML with plugin components
- Supports History API for navigation within the browser

## Features

### Peer Discovery & Monitoring
- Displays peers from environment configuration
- Shows real-time probe status (online/offline) with latency
- Auto-refresh capability with configurable interval
- One-click peer opening in browser tabs

### Tab Interface
- Multi-tab support for browsing multiple repositories
- Quick tab switching and closing
- Tab title shows peer hostname
- Clean, intuitive tab bar

### Repository Browser
- Browse repository file structure via path navigation
- Markdown files rendered as HTML
- Branch selection dropdown
- Real-time path input with go button
- Full markdown support with GitHub Flavored Markdown (GFM)

### Plugin Components in Markdown
- `<Video>` - Native video player with controls
- `<Image>` - Lazy-loaded images
- `<Audio>` - Audio player
- `<Link>` - Internal/external link handling
- `<CodeBlock>` - Syntax-highlighted code blocks

## Tech Stack

- **React 19** - UI framework
- **Vite 6** - Build tool and dev server
- **TypeScript** - Type safety
- **Zustand** - State management
- **react-markdown** - Markdown rendering
- **remark-gfm** - GitHub Flavored Markdown

## Architecture

### State Management (Zustand)
```typescript
// Peers state
peers: PeerInfo[] // List of discovered peers with probe results
setPeers, updatePeer, setPeerProbing

// Tabs state
tabs: TabInfo[] // Open repository tabs
activeTabId: string | null
openTab, closeTab, setActiveTab, updateTab

// Auto-refresh
autoRefreshEnabled: boolean
lastRefreshTs: number
```

### Components
- **PeersView** - Sidebar listing all peers with status
- **TabBar** - Tab management and switching
- **RepoBrowser** - Main content area for browsing repositories
- **MarkdownRenderer** - Renders markdown with plugin components

### Services
- **probing.ts** - Peer health checking and latency measurement
  - `probeHttps()` - Check HTTPS endpoint
  - `probeHttp()` - Check HTTP endpoint
  - `fetchPeerOptions()` - Get peer capabilities
  - `fullProbePeer()` - Complete peer probe

## Usage

### Development

```bash
cd apps/client-web
npm install
npm run dev
```

Runs at `http://localhost:3000` with HMR enabled. Proxies API requests to `http://localhost:8088`.

### Build

```bash
npm run build
```

Creates static output in `dist/` ready for deployment.

### Peer Configuration

Peers can be specified via:
1. **URL parameters**: `?peers=localhost:8088,peer2.example.com`
2. **Environment variable** (if server-injected): `window.RELAY_PEERS`
3. **Default localhost**: Falls back to `localhost:8088` for local dev

## UI Layout

```
┌─────────────────────────────────────────────┐
│          Header (Relay Logo + Title)        │
├─────────────────────────────────────────────┤
│  Tab 1  │  Tab 2  │  Tab 3  │  [Close] ✕  │
├──────────┬─────────────────────────────────┤
│          │                                 │
│ Peers    │      Repository Browser        │
│ List     │  - Path Input & Branch Select  │
│          │  - Markdown Content            │
│ - Peer   │  - Plugin Components          │
│   Status │                                 │
│ - Branches│                                │
│ - Repos  │                                 │
│ - Open   │                                 │
│ Button   │                                 │
│          │                                 │
└──────────┴─────────────────────────────────┘
```

## Workflow

1. **Start**: Web client opens to peer discovery view
2. **Select Peer**: Click "Open" button next to a peer
3. **Browse**: New tab opens showing repository root
4. **Navigate**: Use path input to navigate directories
5. **Switch Tabs**: Click tabs to switch between open repositories
6. **Close Tab**: Click ✕ on tab to close it

## API Integration

The client communicates with Relay servers via:

### OPTIONS Request
```
GET https://peer-host/
Response:
{
  "branches": ["main", "dev"],
  "repos": ["repo1", "repo2"],
  "branchHeads": {"main": "abc123", ...}
}
```

### Content Request
```
GET https://peer-host/path/to/file.md?branch=main&repo=repo1
Response: Markdown content as text
```

## Deployment

### Static Hosting
The built `dist/` contains only static files suitable for:
- Netlify
- Vercel
- AWS S3 + CloudFront
- GitHub Pages
- Any HTTP server

### Environment Variables
Configure peers before serving by:
1. Setting `window.RELAY_PEERS` in HTML before app loads
2. Using URL query parameters: `?peers=host1,host2`
3. Creating a server proxy to inject configuration

## Development Tips

### Adding New Peer Probe Types
1. Add to `PeerProtocol` type in `state/store.ts`
2. Implement probe function in `services/probing.ts`
3. Call from `fullProbePeer()`

### Adding New Components to Markdown
1. Implement component in `plugins/web/components/`
2. Add to `PluginComponents` interface in `plugins/types.ts`
3. Add to `ALLOWED_COMPONENTS` whitelist
4. Update markdown renderer component parsing

### Styling
- Global styles in `index.css`
- Component-specific styles in `Component.css` files
- CSS variables and theme support in `:root`
- Light/dark mode via `@media (prefers-color-scheme)`

## Performance

- Lazy-loaded images in markdown
- Efficient peer probing with timeout and retry
- Memoized selectors in Zustand store
- Code splitting for markdown parser

## Security

- Component whitelisting prevents XSS
- Relative URL resolution prevents open redirects
- CORS handled by server
- No authentication stored in client (delegated to server)

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Modern browsers with ES2020 support

