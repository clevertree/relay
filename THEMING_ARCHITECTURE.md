# Theming Architecture Improvements

## Current State
- **Template** (`/template/hooks/client/colors.js`): Defines color palettes with light/dark themes
- **Tailwind** (`tailwind.config.cjs`): Maps named colors to CSS variables with fallback hex values
- **Runtime** (`colors.js`): Uses `localStorage` and `matchMedia` for theme detection
- **Issue**: System-specific styling logic in template (browser APIs like `localStorage`, `document`)

## Problems with Current Approach
1. **Platform-specific dependencies**: Template uses browser APIs (`window`, `document`, `localStorage`)
2. **CSS variable overhead**: Runtime theme switching requires DOM manipulation
3. **No React Native support**: React Native doesn't support CSS variables or `className` fallbacks
4. **Tight coupling**: Client implementations must replicate theme detection logic
5. **Fragmented styling**: Each platform (Web, React Native, Template) implements theming differently

## Proposed Solution

### Phase 1: Template Layer (Pure Data)
Move `/template/hooks/client/colors.js` to contain **only** theme definitions:
```javascript
// colors.js - Pure data layer, zero dependencies
export const COLORS = {
  light: { /* color definitions */ },
  dark: { /* color definitions */ }
};

// Tailwind color mapping (exported for client use)
export const THEME_COLORS = {
  primary: 'var(--color-primary, #2563eb)',
  // ... etc
};
```

### Phase 2: Client Layer (Web-specific)
Move theme detection and CSS setup to `apps/client-web`:
```typescript
// apps/client-web/src/utils/themeManager.ts
export class ThemeManager {
  static initialize() {
    const theme = this.getPreferredTheme();
    this.applyTheme(theme);
  }
  
  private static getPreferredTheme() {
    // Check localStorage, system preference, etc.
  }
  
  private static applyTheme(theme: 'light' | 'dark') {
    // Set CSS variables, localStorage, data attributes
  }
}
```

### Phase 3: React Native Layer (App-specific)
Move theme detection to `apps/client-react-native`:
```typescript
// apps/client-react-native/src/utils/themeManager.ts
export class ThemeManager {
  static initialize() {
    const theme = this.getPreferredTheme();
    this.applyTheme(theme);
  }
  
  private static getPreferredTheme() {
    // Use async storage, system appearance, etc.
  }
  
  private static applyTheme(theme: 'light' | 'dark') {
    // Store preference, notify app state
  }
}
```

### Phase 4: Tailwind Configuration
Update `tailwind.config.cjs` to support **theme class names**:
```javascript
theme: {
  extend: {
    colors: {
      // Named colors from theme
      primary: 'var(--color-primary, #2563eb)',
      // ...
    }
  }
},
// Add theme configuration
darkMode: 'class', // Use class-based dark mode instead of 'media'
```

## Benefits
✅ **Zero dependencies in template** - Template is pure data  
✅ **Platform-specific implementation** - Each client handles its own theming  
✅ **Reusable theme definitions** - All clients consume same color palette  
✅ **Tailwind class-based themes** - No CSS variable runtime overhead  
✅ **Type-safe** - Export TypeScript types from template  
✅ **Testable** - Theme logic isolated from styling layer  
✅ **Scalable** - Easy to add new themes or customize per client  

## Implementation Steps

### Step 1: Refactor `colors.js` (Template)
Remove all browser APIs:
```javascript
// template/hooks/client/colors.js
export const lightTheme = { /* pure data */ };
export const darkTheme = { /* pure data */ };
export const COLORS = { light: lightTheme, dark: darkTheme };
```

### Step 2: Update Tailwind Config
Switch from CSS variables to class-based theming:
```javascript
darkMode: 'class', // Instead of 'media'
theme: {
  extend: {
    colors: { /* remove css variables */ }
  }
}
```

### Step 3: Create Web Theme Manager
```typescript
// apps/client-web/src/utils/themeManager.ts
- Initialize on app startup
- Detect system preference and saved preference
- Apply theme by toggling `dark` class on root
- Export theme context for components
```

### Step 4: Create React Native Theme Manager
```typescript
// apps/client-react-native/src/utils/themeManager.ts
- Initialize on app startup
- Use AsyncStorage for persistence
- Use Appearance API for system preference
- Update app state with current theme
- Export theme context for components
```

### Step 5: Create Shared Types
```typescript
// apps/shared/types/theme.ts
export type ThemeName = 'light' | 'dark';
export interface ThemeColors { /* ... */ }
export interface Theme {
  name: ThemeName;
  colors: ThemeColors;
}
```

## CSS Class-Based Theming Example

Instead of CSS variables:
```html
<!-- Before: CSS Variables -->
<style>
  :root {
    --color-primary: #2563eb;
  }
  .dark {
    --color-primary: #3b82f6;
  }
</style>
<div className="bg-primary text-primary">Content</div>

<!-- After: Tailwind Class-Based -->
<html class="light"> <!-- or "dark" -->
  <div className="bg-primary text-primary dark:bg-primary-dark">
    Content uses Tailwind's native dark: prefix
  </div>
</html>
```

## Tailwind Color Configuration Update

```javascript
// tailwind.config.cjs - UPDATED
const { COLORS } = require('./template/hooks/client/colors.js');

module.exports = {
  darkMode: 'class', // Class-based instead of media
  theme: {
    extend: {
      colors: {
        // Map theme colors directly (no CSS variables)
        primary: COLORS.light.primary,
        // Use Tailwind's dark: variant for dark theme
      }
    }
  }
};

// In HTML/JSX
<div className="bg-primary dark:bg-primary"> {/* automatically switches */ </div>
```

## Migration Path
1. ✅ Keep backward compatibility by maintaining CSS variables
2. ✅ Gradually migrate components to use class-based dark mode
3. ✅ Move theme logic to client layers
4. ✅ Test on all platforms before deprecating CSS variables

## Summary
This approach ensures:
- **Separation of concerns**: Template = data, Clients = logic
- **Platform independence**: Each client handles its environment
- **Type safety**: Shared types across all implementations
- **Performance**: No runtime DOM manipulation needed
- **Maintainability**: Single source of truth for colors
- **Scalability**: Easy to support multiple themes or custom themes
