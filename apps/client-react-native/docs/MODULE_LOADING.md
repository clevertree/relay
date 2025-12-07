# Module Loading System

## Overview

The module loading system allows hooks and scripts to dynamically load other modules from the same repository. This
works across both web and React Native platforms.

## Web (RepoBrowser.tsx)

The web implementation uses blob URLs and dynamic imports:

```typescript
const loadModule = async (modulePath: string): Promise<any> => {
    // Normalize path (./lib/utils.mjs or /hooks/lib/utils.mjs)
    const moduleUrl = `${protocol}://${host}${normalizedPath}`;
    const code = await fetch(moduleUrl).then(r => r.text());
    const blob = new Blob([code], {type: 'text/javascript'});
    const blobUrl = URL.createObjectURL(blob);
    return await import(blobUrl);
}
```

## React Native (moduleLoader.ts)

React Native doesn't support blob URLs, so we use Function-based execution:

```typescript
import {createLoadModuleHelper} from '../utils/moduleLoader';

const loadModule = createLoadModuleHelper(host, currentPath);
const mod = await loadModule('./lib/utils.mjs');
```

## Usage in Hooks

Hooks receive `helpers.loadModule` in their context:

```javascript
export default async function getClient(context) {
    const {helpers} = context;

    // Load a module
    const utils = await helpers.loadModule('./lib/utils.mjs');
    const {someFunction} = utils;

    // Use the loaded function
    return someFunction();
}
```

## Path Resolution

- **Relative paths**: `./lib/utils.mjs` - Relative to current hook
- **Absolute paths**: `/hooks/lib/utils.mjs` - From repo root
- **Simple names**: `utils.mjs` - Assumes `/hooks/` prefix

## Caching

Both implementations cache loaded modules to avoid redundant fetches:

- **Web**: Blob URLs are created once per module
- **React Native**: Parsed exports are cached by `host:path`

## Example: get-client.jsx with modules

```javascript
// hooks/get-client.jsx
let tmdbClient = null;

export default async function getClient(context) {
    const {helpers} = context;

    // Lazy load on first use
    if (!tmdbClient && helpers.loadModule) {
        tmdbClient = await helpers.loadModule('./lib/client/tmdb-client.mjs');
    }

    // Use loaded module or fallback to inline
    const fetchCreds = tmdbClient?.fetchTmdbCredentials || fetchTmdbCredentials;
    const creds = await fetchCreds();

    // ...rest of getClient logic
}
```

This pattern allows:

- ✅ Code organization (split large hooks into modules)
- ✅ Cross-platform compatibility (web + React Native)
- ✅ Graceful fallback (works with or without modules)
- ✅ Performance (lazy loading + caching)
