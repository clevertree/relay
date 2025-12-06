# Relay Web Client Architecture

## Overview

The Relay Web Client is a browser-based interface for discovering and browsing Relay peer repositories. It provides a
multi-tab interface similar to the React Native client, but optimized for web browsers.

## Core Concepts

### Peers

A peer is a Relay server instance that hosts repositories and responds to peer discovery probes. Peers are identified by
their hostname/IP and port (e.g., `localhost:8080`).

### Repositories

Each peer can host multiple repositories accessible via subpaths. Repositories contain markdown files and other content
that can be browsed through the web client.

### Tabs

Each open repository browser session is represented as a tab. Users can have multiple tabs open, each connected to a
different peer or path.

### Probing

The client periodically probes peers to determine their status (online/offline) and measure latency. This information is
displayed in the peer list.

## State Management

### Store Structure (Zustand)

```typescript
// Peer state
peers: PeerInfo[] = [
  {
    host: "localhost:8080",
    probes: [
      { protocol: "https", port: 443, ok: true, latencyMs: 15 }
    ],
    branches: ["main", "dev"],
    repos: ["repo1", "repo2"],
    isProbing: false,
    lastUpdateTs: 1701614400000
  }
]

// Tab state
tabs: TabInfo[] = [
  {
    id: "tab-1-1701614400123",
    host: "localhost:8080",
    path: "/README.md",
    title: "localhost:8080",
    branches: ["main", "dev"],
    currentBranch: "main"
  }
]

activeTabId: "tab-1-1701614400123"
autoRefreshEnabled: true
lastRefreshTs: 1701614400000
```

### State Actions

**Peer Management:**

- `setPeers(hosts: string[])` - Initialize peers list
- `updatePeer(host, updater)` - Update peer probe results
- `setPeerProbing(host, isProbing)` - Set probing state

**Tab Management:**

- `openTab(host, path?)` - Open new repository tab
- `closeTab(tabId)` - Close tab
- `setActiveTab(tabId)` - Switch to tab
- `updateTab(tabId, updater)` - Update tab state

**Auto-refresh:**

- `setAutoRefresh(enabled)` - Enable/disable auto-probing
- `setLastRefreshTs(ts)` - Record last probe time

## Component Hierarchy

```
App
├── Header
│   └── Logo + Title
├── TabBar
│   ├── Tab (x N)
│   │   ├── Title
│   │   └── Close Button
│   └── [Empty State]
├── Layout (Sidebar + Main)
│   ├── Sidebar (PeersView)
│   │   ├── Header (Refresh + AutoRefresh Toggle)
│   │   └── PeersList
│   │       └── PeerItem (x N)
│   │           ├── Status (Online/Offline + Latency)
│   │           ├── Branches List
│   │           ├── Repos List
│   │           └── Open Button
│   │
│   └── Main Content
│       ├── Empty State (No Tab Selected)
│       └── RepoBrowser (When Tab Active)
│           ├── Header
│           │   ├── Peer Info
│           │   ├── Path Input
│           │   ├── Branch Selector
│           │   └── Refresh Button
│           └── Content
│               ├── Loading State
│               ├── Error State
│               └── MarkdownRenderer
│                   ├── Markdown (react-markdown)
│                   └── Plugin Components
```

## Data Flow

### Initialization

```
App mounts
  ↓
Load peers from environment/URL params
  ↓
Probe each peer (fullProbePeer)
  ↓
Update peer list with status
  ↓
Auto-refresh interval started
```

### Opening a Repository

```
User clicks "Open" on peer
  ↓
openTab(host, "/")
  ↓
Add to tabs list, set as active
  ↓
TabBar re-renders, shows new tab
  ↓
RepoBrowser mounts with tabId
  ↓
Fetch peer options (branches, repos)
  ↓
Fetch content from "/" path
  ↓
MarkdownRenderer displays content
```

### Navigating Within Repository

```
User enters path and clicks "Go"
  ↓
updateTab with new path
  ↓
RepoBrowser detects path change
  ↓
Fetch content from new path
  ↓
MarkdownRenderer updates
```

### Switching Tabs

```
User clicks tab
  ↓
setActiveTab(tabId)
  ↓
Tab highlighting updates
  ↓
Main content switches to RepoBrowser for that tab
```

## Probing Strategy

### Probe Sequence

For each peer:

1. Try HTTPS with 3 samples
2. If HTTPS fails, try HTTP with 3 samples
3. Measure latency as median of samples
4. Timeout each probe after 5 seconds

### Probe Timing

- **Initial**: When app loads
- **Manual**: When user clicks "Refresh"
- **Auto**: Every 10 seconds if enabled
- **Triggered**: When peer first added to list

### Latency Calculation

```
Samples: [12ms, 15ms, 18ms]
Median: 15ms
Display: "Online (15ms)"
```

## Content Fetching

### URL Resolution

```
Peer: "localhost:8080"
Path: "/docs/guide"
  ↓
Protocol: Prefer HTTPS, fallback to HTTP
  ↓
URL: "https://localhost:8080/docs/guide"
  ↓
If no extension: append "/index.md"
  ↓
Final: "https://localhost:8080/docs/guide/index.md"
```

### Request Headers

```
X-Relay-Branch: main (if set)
X-Relay-Repo: repo1 (if set)
```

### Response Handling

- 200: Parse markdown and render
- 404: Show error with message
- 5xx: Show error with status text
- Network error: Show error

## Markdown Rendering

### Component Processing

```
Raw markdown with components:
"# Title\n<Video src='...' />\nText"
  ↓
Parse markdown to AST
  ↓
Extract custom components
  ↓
Replace with placeholders: <!-- CUSTOM_COMPONENT_0 -->
  ↓
Render markdown to HTML
  ↓
Render extracted components separately
```

### Supported Components

- Video, Image, Audio (plugin components)
- Inline code, code blocks (markdown native)
- Links (intercepted for navigation)
- Tables, lists, headings (markdown native)

### Component Whitelisting

Only components in `ALLOWED_COMPONENTS` are rendered:

```typescript
'Video', 'Image', 'Audio', 'Link', 'CodeBlock'
```

All other HTML tags are stripped from markdown.

## Styling & Responsive Design

### Layout Breakpoints

```
Desktop (> 768px): Sidebar + Main (horizontal split)
Mobile (≤ 768px): Sidebar above Main (vertical split)
```

### Color Scheme

- Light mode: White background, dark text
- Dark mode: Dark background, light text
- Accent: #646cff (Indigo)
- Status: #28a745 (Green) online, #dc3545 (Red) offline

### Component Styles

- Peer items: Card-like with hover effects
- Tabs: Minimalist with active indicator
- Buttons: Simple with color transitions
- Input: Standard HTML with custom styling

## API Contracts

### OPTIONS Endpoint

Returns peer capabilities:

```typescript
{
  "branches": ["main", "develop"],
  "repos": ["docs", "code"],
  "branchHeads": {
    "main": "abc123",
    "develop": "def456"
  }
}
```

### Content Endpoint

Returns file content:

```
GET /path/to/file.md
→ text/markdown response
```

### Query Parameters

```
?branch=main      - Select branch
?repo=docs        - Select repository
```

## Performance Considerations

### Optimizations

- Lazy image loading in markdown
- Memoized Zustand selectors to prevent re-renders
- Efficient peer probing (parallel, timeout)
- Code splitting via Vite (react-markdown in separate chunk)

### Potential Improvements

- Virtual scrolling for large peer lists
- Incremental markdown rendering
- Peer proxy caching
- Content compression

## Error Handling

### Peer Probing Errors

- Network timeout: Mark as offline
- Connection refused: Mark as offline
- Invalid response: Mark as offline
- Display latency only if available

### Content Loading Errors

- 404: Show "Content not found" message
- 5xx: Show server error
- Network error: Show connection error
- Provide "Try Again" button

## Security

### Input Validation

- Paths validated to prevent traversal (not yet implemented)
- Component names whitelisted
- Component props sanitized from string attributes

### CORS

- Handled by server (requires CORS headers)
- Client respects CORS restrictions

### XSS Prevention

- Component whitelisting prevents arbitrary HTML
- No `innerHTML` used, all content via React

## Extension Points

### Adding New Peer Probe Types

Edit `services/probing.ts` and add new protocol handlers

### Adding New Components

1. Create component in `plugins/web/components/`
2. Add to `ALLOWED_COMPONENTS`
3. Add to `PluginComponents` interface
4. Implement in web plugin

### Customizing Styling

Edit component CSS files or global `index.css`

### Changing State Management

Replace Zustand with Redux/Valtio/other in `state/store.ts`

## Testing

### Unit Tests (TODO)

- Peer probing functions
- URL resolution
- Component parsing
- State mutations

### Integration Tests (TODO)

- Full peer discovery flow
- Tab management flow
- Content loading flow

### E2E Tests (TODO)

- User interactions with live server
- Multi-tab navigation
- Auto-refresh behavior
