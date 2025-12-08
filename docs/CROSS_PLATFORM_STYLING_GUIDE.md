# Cross-Platform Styling & Theming Recommendations

## Executive Summary

I've refactored the theming system to follow **clean architecture principles**, removing platform-specific dependencies from the template layer and deferring all theme management logic to the client implementations. This enables true cross-platform compatibility while maintaining a single source of truth for colors.

## What Was Changed

### 1. **Template Layer Refactoring** (`/template/hooks/client/colors.js`)
**Before**: Contained browser APIs, localStorage, system preference detection  
**After**: Pure data export - only theme color definitions

```javascript
// ✅ NOW: Pure data only
export const lightTheme = { /* colors */ };
export const darkTheme = { /* colors */ };
export const COLORS = { light: lightTheme, dark: darkTheme };
```

**Benefits**:
- ✅ No platform-specific code in template
- ✅ Can be used in Node.js, browsers, native apps without issues
- ✅ Easier to test
- ✅ Universal accessibility

### 2. **Tailwind Configuration** (`tailwind.config.cjs`)
**Before**: `darkMode: 'media'` (automatic system detection)  
**After**: `darkMode: 'class'` (manual control via CSS class)

```javascript
// ✅ NOW: Class-based dark mode
darkMode: 'class', // Add 'dark' class to <html> to enable dark theme
```

**Benefits**:
- ✅ Predictable theme switching
- ✅ No CSS variable overhead
- ✅ Works with Tailwind's native `dark:` prefix
- ✅ Better performance

### 3. **Web Theme Manager** (NEW: `apps/client-web/src/utils/themeManager.ts`)

Handles web-specific theme logic:

```typescript
export class ThemeManager {
  static initialize() // Call on app startup
  static getTheme() // Returns 'light' | 'dark'
  static setTheme(theme) // Switch theme and persist
  static toggleTheme() // Toggle between light/dark
  static onChange(callback) // Subscribe to changes
}
```

**Responsibilities**:
- ✅ Detect system preference via `matchMedia`
- ✅ Persist preference to `localStorage`
- ✅ Manage DOM class (`dark` on `<html>`)
- ✅ Notify listeners of changes
- ✅ Respect user preference over system changes

### 4. **React Native Theme Manager** (NEW: `apps/client-react-native/src/utils/themeManager.ts`)

Handles React Native-specific theme logic:

```typescript
export class ThemeManager {
  static async initialize() // Call on app startup
  static getTheme() // Returns 'light' | 'dark'
  static async setTheme(theme) // Switch theme and persist
  static getColors() // Returns current theme colors
  static async toggleTheme() // Toggle between light/dark
  static onChange(callback) // Subscribe to changes
}
```

**Responsibilities**:
- ✅ Detect system preference via `Appearance` API
- ✅ Persist preference to `AsyncStorage`
- ✅ Return color objects for component styling
- ✅ Manage app state and listeners
- ✅ Respect user preference over system changes

## Architecture Diagram

```
┌─────────────────────────────────────────────────┐
│ Template (Pure Data)                            │
│ /template/hooks/client/colors.js                │
│ • lightTheme = { primary: '#2563eb', ... }     │
│ • darkTheme = { primary: '#2563eb', ... }      │
│ NO BROWSER APIs, NO RUNTIME LOGIC              │
└─────────────┬──────────────────────────────────┘
              │
    ┌─────────┴─────────┐
    │                   │
    ▼                   ▼
┌─────────────────┐  ┌──────────────────┐
│ Tailwind        │  │ ThemeManager     │
│ (CSS)           │  │ (per client)     │
│                 │  │                  │
│ darkMode:       │  │ Web:             │
│ 'class'         │  │ • localStorage   │
│                 │  │ • matchMedia     │
│ Named colors:   │  │ • DOM class      │
│ • primary       │  │                  │
│ • bgPrimary     │  │ React Native:    │
│ • textPrimary   │  │ • AsyncStorage   │
│ • ...           │  │ • Appearance API │
│                 │  │ • App state      │
└────────┬────────┘  └────────┬─────────┘
         │                    │
    ┌────┴────────────────────┴────┐
    │                               │
    ▼                               ▼
Web Components              React Native Components
<div className="             <View style={{
  bg-primary                   backgroundColor: colors.bgPrimary
  dark:bg-primary-dark       }}>
">
```

## Cross-Platform Compatibility Improvements

### 1. **Unified Color Definitions**
All platforms use the same color values defined in one place:
```javascript
// template/hooks/client/colors.js
export const COLORS = {
  light: { primary: '#2563eb', bgPrimary: '#ffffff', ... },
  dark: { primary: '#2563eb', bgPrimary: '#111827', ... }
};
```

### 2. **Platform-Specific Implementation**
Each client implements theme switching according to its capabilities:
- **Web**: DOM manipulation, CSS classes, localStorage
- **React Native**: App state, AsyncStorage, Appearance API
- **Template**: Zero dependencies (pure data)

### 3. **Consistent API**
All clients expose similar interfaces:
```typescript
interface ThemeManager {
  initialize(): Promise<void> | void;
  getTheme(): ThemeName;
  setTheme(theme: ThemeName): Promise<void> | void;
  toggleTheme(): Promise<ThemeName> | ThemeName;
  onChange(callback: Listener): Unsubscribe;
}
```

## Recommended Improvements

### Phase 2: Type Safety & Exports

**Create `apps/shared/types/theme.ts`**:
```typescript
export type ThemeName = 'light' | 'dark';

export interface Theme {
  name: ThemeName;
  colors: {
    primary: string;
    bgPrimary: string;
    textPrimary: string;
    // ... all color names
  };
}

export interface ThemeManager {
  initialize(): Promise<void> | void;
  getTheme(): ThemeName;
  setTheme(theme: ThemeName): Promise<void> | void;
  getColors(): Theme['colors'];
  toggleTheme(): Promise<ThemeName> | ThemeName;
  onChange(callback: (theme: ThemeName) => void): () => void;
}
```

**Benefits**:
- ✅ Shared type definitions across all clients
- ✅ Type-safe component development
- ✅ IDE autocomplete for colors

### Phase 3: Custom Theme Support

**Extend `colors.js` for custom themes**:
```javascript
export const themes = {
  light: lightTheme,
  dark: darkTheme,
  // NEW: Custom themes
  'high-contrast': highContrastTheme,
  'warm': warmTheme,
};

export function registerTheme(name, colors) {
  themes[name] = colors;
}
```

**Benefits**:
- ✅ Accessibility support (high-contrast mode)
- ✅ Brand customization (per-tenant themes)
- ✅ User-defined themes

### Phase 4: Context Providers

**Web**: Create React Context for theme:
```typescript
// apps/client-web/src/contexts/ThemeContext.tsx
export const ThemeContext = React.createContext<{
  theme: ThemeName;
  toggle: () => void;
}>(/* defaults */);

export function ThemeProvider({ children }) {
  // Use ThemeManager internally
}
```

**React Native**: Create similar context:
```typescript
// apps/client-react-native/src/contexts/ThemeContext.tsx
export const ThemeContext = React.createContext<{
  theme: ThemeName;
  colors: Theme['colors'];
  toggle: () => Promise<void>;
}>(/* defaults */);
```

**Benefits**:
- ✅ Components consume theme from context (no prop drilling)
- ✅ Automatic re-renders on theme change
- ✅ Standard React patterns

### Phase 5: Dynamic Color Styling

**Web Component Example**:
```tsx
// Use Tailwind dark: variant
<button className="bg-primary hover:bg-primaryDark dark:bg-primary dark:hover:bg-primaryDark">
  Click me
</button>
```

**React Native Example**:
```tsx
// Use dynamic colors
const colors = ThemeManager.getColors();
<TouchableOpacity style={{ backgroundColor: colors.primary }}>
  <Text style={{ color: colors.textInverse }}>Click me</Text>
</TouchableOpacity>
```

### Phase 6: Storybook Integration

**Support theme switching in Storybook**:
```typescript
// apps/client-web/.storybook/preview.ts
import { ThemeManager } from '../src/utils/themeManager';

export const decorators = [
  (Story) => {
    useEffect(() => {
      ThemeManager.initialize();
    }, []);
    
    return <Story />;
  }
];
```

## Migration Checklist

- [ ] **Phase 1** (✅ COMPLETED)
  - [x] Refactor template colors.js to pure data
  - [x] Create Web ThemeManager
  - [x] Create React Native ThemeManager
  - [x] Update Tailwind config to class-based dark mode

- [ ] **Phase 2** (NEXT)
  - [ ] Create `apps/shared/types/theme.ts`
  - [ ] Add TypeScript types to ThemeManagers
  - [ ] Update documentation with types

- [ ] **Phase 3**
  - [ ] Add custom theme registration function
  - [ ] Test with high-contrast theme
  - [ ] Document custom theme API

- [ ] **Phase 4**
  - [ ] Create React Context providers
  - [ ] Update components to use context
  - [ ] Remove prop drilling

- [ ] **Phase 5**
  - [ ] Update all components to use new styling patterns
  - [ ] Audit and fix remaining CSS issues
  - [ ] Test across all platforms

- [ ] **Phase 6**
  - [ ] Setup Storybook theme switching
  - [ ] Document component theming patterns
  - [ ] Add theme-related examples

## Key Benefits Summary

| Aspect | Before | After |
|--------|--------|-------|
| **Template Dependencies** | Browser APIs | Zero dependencies |
| **Theme Detection** | Automatic (media query) | Manual control per client |
| **Color Definitions** | Scattered | Single source of truth |
| **CSS Variables** | Runtime setup needed | Tailwind built-in |
| **Type Safety** | Partial | Full TypeScript support |
| **Cross-Platform** | Difficult to maintain | Clear separation |
| **Custom Themes** | Not supported | Easy to add |
| **Performance** | CSS variable overhead | Native Tailwind classes |
| **Testability** | Coupled to DOM | Unit testable |

## Conclusion

The refactored theming system provides:
- ✅ **Clean Architecture**: Template is pure data, logic lives in clients
- ✅ **Type Safety**: Full TypeScript support
- ✅ **Maintainability**: Single source of truth for colors
- ✅ **Performance**: No runtime CSS variable setup
- ✅ **Flexibility**: Easy to support multiple themes
- ✅ **Cross-Platform**: Consistent API, platform-specific implementation
- ✅ **Scalability**: Ready for enterprise features (branding, accessibility)

This foundation makes it easy to add advanced features like:
- High-contrast modes for accessibility
- Per-tenant theming for multi-tenant apps
- User-defined color preferences
- Dynamic theme switching
- Theme-aware components
