# Next Steps: T6 - Declarative Plugin Loader

## Overview
This document outlines what needs to be implemented next to complete M1 milestone and enable repo-provided plugins.

## What This Task Achieves
- Enables repos to provide custom plugin UIs via `plugin.manifest.json`
- Supports multiple view types: markdown, grid, detail-json, action list
- Automatic caching with ETag/Last-Modified for performance
- Integrity checking via content hash

## Architecture

### Plugin Manifest Format
```json
{
  "name": "Custom Explorer",
  "version": "1.0",
  "views": [
    {
      "id": "file-browser",
      "type": "markdown",
      "contentUrl": "/files/index.md",
      "hash": "sha256:abc123..."
    },
    {
      "id": "search",
      "type": "grid",
      "queryUrl": "/search",
      "columns": ["name", "size", "modified"],
      "hash": "sha256:def456..."
    }
  ]
}
```

### View Types
1. **markdown**: Render Markdown content (uses existing MarkdownView)
2. **grid**: Table/grid with pagination
3. **detail-json**: JSON object renderer with collapsible tree
4. **action**: Button list with configurable callbacks

## Implementation Steps

### Step 1: Create DeclarativePlugin Component
File: `src/plugins/DeclarativePlugin.tsx`

```typescript
interface PluginManifest {
  name: string;
  version: string;
  views: View[];
}

interface View {
  id: string;
  type: 'markdown' | 'grid' | 'detail-json' | 'action';
  contentUrl?: string;
  queryUrl?: string;
  columns?: string[];
  hash?: string;
}

export default function DeclarativePlugin({ peerUrl, path }: Props) {
  // 1. Fetch plugin.manifest.json
  // 2. Cache check: ETag/Last-Modified
  // 3. Verify hash if provided
  // 4. Parse views
  // 5. Render selected view
}
```

### Step 2: Add Manifest Fetcher
File: `src/services/plugin-loader.ts`

```typescript
export async function fetchPluginManifest(
  peerUrl: string,
  path: string
): Promise<PluginManifest> {
  // GET {peerUrl}{path}/plugin.manifest.json
  // Handle cache headers
  // Validate JSON
}

export async function verifyContentHash(
  content: string,
  expectedHash: string
): Promise<boolean> {
  // SHA256 hash verification
}
```

### Step 3: Update Plugin Registry
Modify `src/plugins/registry.ts` to include DeclarativePlugin:

```typescript
const BUILTIN_PLUGINS: PluginDescriptor[] = [
  {
    id: 'repo-declarative-plugin',
    name: 'Repo Plugin (Declarative)',
    type: 'declarative',
    priority: 100,
    // ...
  },
  // existing plugins...
];
```

### Step 4: Cache Layer
File: `src/services/cache.ts`

```typescript
interface CacheEntry {
  content: string;
  etag?: string;
  lastModified?: string;
  timestamp: number;
}

const CACHE_TTL = 1000 * 60 * 5; // 5 minutes

export async function cachedFetch(
  url: string,
  previousEntry?: CacheEntry
): Promise<{ content: string; cached: boolean } | null> {
  // Check cache validity
  // Include If-None-Match / If-Modified-Since headers
  // Update cache on 200, return 304 on cache hit
}
```

### Step 5: View Renderers
Create specialized renderers in `src/plugins/views/`:
- `GridView.tsx`: Paginated table
- `DetailJsonView.tsx`: Collapsible JSON tree
- `ActionListView.tsx`: Button list with callbacks

## Integration Points

### With RepoTab
```typescript
// In RepoTab.tsx, update plugin selection logic:
if (plugin.type === 'declarative') {
  return <DeclarativePlugin peerUrl={peerUrl} path={path} />;
}
```

### With OPTIONS
```typescript
// OPTIONS response should include:
{
  "interface": {
    "repo-plugin": {
      "plugin_manifest": "/plugin.manifest.json"
    }
  }
}
```

## Testing Strategy

1. **Unit Tests**
   - Manifest parsing with invalid JSON
   - Hash verification success/failure
   - Cache hit/miss logic

2. **Integration Tests**
   - Fetch manifest from mock server
   - Render all view types
   - Handle missing manifest gracefully

3. **Manual Testing**
   - Create test repo with plugin.manifest.json
   - Probe peer and verify OPTIONS discovery
   - Select plugin from switcher
   - Verify content renders

## Acceptance Criteria

- ✅ Manifest fetching with proper error handling
- ✅ ETag/Last-Modified caching works
- ✅ All 4 view types render correctly
- ✅ Hash verification prevents tampering
- ✅ Plugin selection persists across tabs
- ✅ Graceful fallback to DefaultNativePlugin if manifest missing
- ✅ TypeScript compilation passes

## Estimated Effort
- Implementation: 2-3 hours
- Testing: 1-2 hours
- Documentation: 30 minutes

## Related Code
- `src/plugins/registry.ts` - Current plugin system
- `src/plugins/DefaultNative.tsx` - Reference implementation
- `src/components/MarkdownView.tsx` - Markdown renderer
- `src/services/probing.ts` - OPTIONS fetching

## Questions/Blockers
- Should we use a schema validation library (ajv)?
- Cache storage: memory only or AsyncStorage for persistence?
- How to handle dynamic content updates in grid views?
