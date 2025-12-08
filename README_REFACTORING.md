# README.md Refactoring: Moving Logic to Template Layer

## Summary

Successfully refactored the Relay codebase to **remove all hardcoded README.md logic from clients** and move it exclusively to the template layer. Only the `/template` directory now references `README.md`.

**Commit**: `c3ab26f` - "refactor: move README.md logic to template layer"

---

## Problem Statement

Previously, README.md was hardcoded as the default path in multiple places:
- Web client store (`openTab` default)
- Web client App component (peer press handler)
- Web client RepoBrowser (path fallback)
- React Native client store (`openTab` default)
- Template Layout component (default path)

This created:
- ❌ Tight coupling between clients and template
- ❌ Scattered default logic across codebase
- ❌ Difficulty changing template behavior
- ❌ Clients that only work with specific files

---

## Solution

Changed default path from `/README.md` to `/` across all clients, and added explicit template handler:

### 1. Web Client (`apps/client-web`)

**`src/state/store.ts`**
```typescript
// Before
openTab: (host, path = '/README.md') => { ... }

// After
openTab: (host, path = '/') => { ... }
```

**`src/App.tsx`**
```typescript
// Before
handlePeerPress = (host: string) => { openTab(host, '/README.md') }

// After
handlePeerPress = (host: string) => { openTab(host, '/') }
```

**`src/components/RepoBrowser.tsx`**
```typescript
// Before
path: tab?.path ?? '/README.md'

// After
path: tab?.path ?? '/'
```

### 2. React Native Client (`apps/client-react-native`)

**`src/state/store.ts`**
```typescript
// Before
openTab: async (host, path = '/README.md') => { ... }

// After
openTab: async (host, path = '/') => { ... }
```

### 3. Template Layer (`template/hooks/client`)

**`components/Layout.jsx`**
```jsx
// Before
const path = (params && params.path) || '/README.md'
// And in onChangeBranch:
helpers.navigate(path || '/README.md')
// And placeholder:
placeholder="Enter path... (/README.md)"

// After
const path = (params && params.path) || '/'
// And in onChangeBranch:
helpers.navigate(path || '/')
// And placeholder:
placeholder="Enter path... (/ or /README.md)"
```

**`get-client.jsx`** (New Handler)
```jsx
// Root path (/) - render template README.md
if (path === '/') {
    console.debug('[get-client] Root path matched, rendering template README.md');
    const readmeElement = <FileRenderer path="/README.md"/>;
    return wrap(readmeElement, await fetchOptions());
}
```

---

## Architecture Flow

### Old Flow (Hardcoded everywhere)
```
User clicks peer
  ↓
App.tsx openTab(host, '/README.md')  ← HARDCODED
  ↓
store.ts openTab default = '/README.md'  ← HARDCODED
  ↓
RepoBrowser default path = '/README.md'  ← HARDCODED
  ↓
Template Layout defaults to '/README.md'  ← HARDCODED
  ↓
Renders /README.md file
```

### New Flow (Template-controlled)
```
User clicks peer
  ↓
App.tsx openTab(host, '/')  ← GENERIC
  ↓
store.ts openTab default = '/'  ← GENERIC
  ↓
RepoBrowser default path = '/'  ← GENERIC
  ↓
Template Layout receives path = '/'
  ↓
get-client.jsx detects path === '/'
  ↓
Renders FileRenderer({path: '/README.md'})  ← ONLY HERE
  ↓
Renders template/README.md file
```

---

## Key Benefits

✅ **Single Source of Truth**: Only the template knows about README.md mapping
✅ **Cleaner Clients**: No hardcoded file references in client code
✅ **Better Separation**: Template is responsible for its own UX defaults
✅ **Easier to Modify**: Change template behavior without touching clients
✅ **More Flexible**: Clients work with any template, any structure
✅ **Maintainability**: Future changes only need template updates

---

## How It Works

1. **Client initiates navigation** with generic path `/`
2. **Client sends path to template** (via HTTP GET with `path` param)
3. **Template hook (`get-client.jsx`)** intercepts root path
4. **Template decides** to render `/README.md` for root path
5. **FileRenderer** loads and displays the file

The template completely controls what gets rendered for the root path. Clients don't need to know about implementation details.

---

## Customization Examples

### Change Root Path to Show Different File

In `template/hooks/client/get-client.jsx`:
```jsx
// Show CHANGELOG instead of README
if (path === '/') {
    const changelogElement = <FileRenderer path="/CHANGELOG.md"/>;
    return wrap(changelogElement, await fetchOptions());
}
```

### Add Multiple Root Path Handlers

```jsx
if (path === '/') {
    // Show README for root
    const readmeElement = <FileRenderer path="/README.md"/>;
    return wrap(readmeElement, await fetchOptions());
}

if (path === '/overview') {
    // Show custom overview
    const overviewElement = <FileRenderer path="/OVERVIEW.md"/>;
    return wrap(overviewElement, await fetchOptions());
}
```

### Render Custom JSX for Root

```jsx
if (path === '/') {
    const customElement = h('div', {className: 'welcome'}, [
        h('h1', null, 'Welcome to Repository'),
        h('p', null, 'Please select a file to view...')
    ]);
    return wrap(customElement, await fetchOptions());
}
```

---

## Files Changed

| File | Change | Impact |
|------|--------|--------|
| `apps/client-web/src/state/store.ts` | Default path: `/README.md` → `/` | Generic client |
| `apps/client-web/src/App.tsx` | Peer handler: `/README.md` → `/` | Generic navigation |
| `apps/client-web/src/components/RepoBrowser.tsx` | Fallback: `/README.md` → `/` | Generic path |
| `apps/client-react-native/src/state/store.ts` | Default path: `/README.md` → `/` | Generic client |
| `template/hooks/client/components/Layout.jsx` | Default: `/README.md` → `/` | Generic defaults |
| `template/hooks/client/get-client.jsx` | **+5 lines** (new root handler) | Template control |

---

## Build Status

✅ Web client builds successfully
✅ TypeScript compilation passes
✅ No linting warnings
✅ All changes committed and pushed

---

## Testing the Changes

### Navigate to Root
- Click any peer in web/React Native client
- Client now sends path `/` to template
- Template intercepts and renders `/README.md`
- Same behavior as before, but cleaner architecture

### Check Path Flow
1. Open web client
2. Click a peer → navigates to `/`
3. Layout renders with default path `/`
4. get-client.jsx handles root path
5. README.md is displayed

---

## Migration for Custom Templates

If you have a custom template, update your `get-client.jsx`:

```jsx
// Add this block to handle root path
if (path === '/') {
    // Render whatever you want for root path
    const element = <FileRenderer path="/README.md"/>;
    return wrap(element, await fetchOptions());
}
```

This gives you full control over what the root path displays.

---

## Backward Compatibility

Clients remain fully backward compatible:
- Old bookmarks to `/README.md` still work
- Direct navigation to files still works
- Only the default behavior changed
- Template decides what `/` means

---

## Future Improvements

1. **Template Configuration**: Allow templates to define root path behavior via config
2. **Multiple Landing Pages**: Support different root pages based on context
3. **Dynamic Routing**: Template could decide root content based on file existence
4. **Template Plugins**: Allow template plugins to handle custom paths

---

## Commit History

```
c3ab26f (HEAD -> main, origin/main)
refactor: move README.md logic to template layer
  - Change default path from '/README.md' to '/' across all clients
  - Move README.md mapping to template/get-client.jsx
  - Update Layout.jsx placeholder text
  - Update web and React Native store defaults
```

**Status**: ✅ Committed and pushed to origin/main
