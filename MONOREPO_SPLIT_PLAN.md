# Monorepo Split Plan - Relay Project

**Date**: December 17, 2025  
**Status**: Planning Phase

## Overview

Split the Relay monorepo into independent repositories with scoped npm packages for shared libraries.

### Goals
1. Create separate git repositories for logical project components
2. Publish `@clevertree/hook-transpiler` and `@clevertree/themed-styler` as npm packages
3. Split `apps/shared` into client and server shared libraries
4. Maintain all existing functionality (WASM, Android/iOS native modules)
5. Enable independent versioning and release cycles

---

## Repository Structure (After Split)

### New Repository Layout

```
~/dev/
├── relay-server/              # Server repository
├── relay-clients/             # Web + React Native clients
├── hook-transpiler/           # @clevertree/hook-transpiler npm package
├── themed-styler/             # @clevertree/themed-styler npm package
└── relay/                     # Original monorepo (archived/reference)
```

---

## Phase 1: Create NPM Packages

### 1.1 `@clevertree/hook-transpiler`

**Package Contents:**
```
hook-transpiler/
├── package.json
├── README.md
├── LICENSE
├── Cargo.toml
├── src/                       # Rust source
│   └── lib.rs
├── wasm/                      # WASM build artifacts
│   ├── hook_transpiler.js
│   ├── hook_transpiler_bg.wasm
│   └── hook_transpiler.d.ts
├── android/                   # Android native module
│   ├── build.gradle
│   └── src/main/java/com/clevertree/
├── ios/                       # iOS native module
│   └── HookTranspiler.xcframework/
├── scripts/
│   ├── build-wasm.sh
│   ├── build-android.sh
│   └── build-ios.sh
└── examples/
    ├── web/
    ├── react-native/
    └── node/
```

**package.json:**
```json
{
  "name": "@clevertree/hook-transpiler",
  "version": "0.2.0",
  "description": "JSX/TSX transpiler with WASM and native module support",
  "license": "MIT OR Apache-2.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": [
    "dist/",
    "wasm/",
    "android/",
    "ios/",
    "src/",
    "Cargo.toml",
    "README.md"
  ],
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./wasm": {
      "types": "./wasm/hook_transpiler.d.ts",
      "default": "./wasm/hook_transpiler.js"
    },
    "./android": "./android/build.gradle",
    "./ios": "./ios/HookTranspiler.xcframework"
  },
  "scripts": {
    "build": "npm run build:wasm && npm run build:types",
    "build:wasm": "bash scripts/build-wasm.sh",
    "build:android": "bash scripts/build-android.sh",
    "build:ios": "bash scripts/build-ios.sh",
    "build:types": "tsc",
    "test": "cargo test",
    "prepublishOnly": "npm run build"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/clevertree/hook-transpiler.git"
  },
  "keywords": [
    "jsx",
    "tsx",
    "transpiler",
    "wasm",
    "react-native",
    "android",
    "ios"
  ]
}
```

**Migration Steps:**
1. Copy `crates/hook-transpiler/` to `~/dev/hook-transpiler/`
2. Add TypeScript wrapper for WASM and native modules
3. Create build scripts for all platforms
4. Add example projects
5. Set up CI/CD for npm publishing
6. Publish to npm as `@clevertree/hook-transpiler`

---

### 1.2 `@clevertree/themed-styler`

**Package Contents:**
```
themed-styler/
├── package.json
├── README.md
├── LICENSE
├── Cargo.toml
├── src/                       # Rust source
├── assets/
│   └── theme.yaml            # Default theme
├── wasm/                     # WASM build artifacts
│   ├── themed_styler.js
│   ├── themed_styler_bg.wasm
│   └── themed_styler.d.ts
├── android/                  # Android native module
│   ├── build.gradle
│   └── src/main/java/com/clevertree/
├── ios/                      # iOS native module
│   └── ThemedStyler.xcframework/
├── scripts/
│   ├── build-wasm.sh
│   ├── build-android.sh
│   └── build-ios.sh
└── examples/
    ├── web/
    ├── react-native/
    └── themes/
```

**package.json:**
```json
{
  "name": "@clevertree/themed-styler",
  "version": "0.2.0",
  "description": "Runtime styling engine with theme support for web and React Native",
  "license": "MIT OR Apache-2.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": [
    "dist/",
    "wasm/",
    "android/",
    "ios/",
    "assets/",
    "src/",
    "Cargo.toml",
    "README.md"
  ],
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./wasm": {
      "types": "./wasm/themed_styler.d.ts",
      "default": "./wasm/themed_styler.js"
    },
    "./android": "./android/build.gradle",
    "./ios": "./ios/ThemedStyler.xcframework",
    "./theme": "./assets/theme.yaml"
  },
  "scripts": {
    "build": "npm run build:wasm && npm run build:types",
    "build:wasm": "bash scripts/build-wasm.sh",
    "build:android": "bash scripts/build-android.sh",
    "build:ios": "bash scripts/build-ios.sh",
    "build:types": "tsc",
    "test": "cargo test",
    "prepublishOnly": "npm run build"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/clevertree/themed-styler.git"
  },
  "keywords": [
    "styling",
    "theme",
    "tailwind",
    "wasm",
    "react-native",
    "android",
    "ios"
  ]
}
```

**Migration Steps:**
1. Copy `crates/themed-styler/` to `~/dev/themed-styler/`
2. Add TypeScript wrapper for WASM and native modules
3. Create build scripts for all platforms
4. Add example projects and theme examples
5. Set up CI/CD for npm publishing
6. Publish to npm as `@clevertree/themed-styler`

---

## Phase 2: Split apps/shared

### 2.1 `@clevertree/relay-client-shared`

**Purpose:** Shared utilities for Relay clients (web + React Native)

**Package Contents:**
```
relay-client-shared/
├── package.json
├── src/
│   ├── index.ts
│   ├── runtimeLoader.ts       # Hook runtime loader
│   ├── urlBuilder.ts           # URL construction
│   ├── wasmLoader.ts           # WASM initialization
│   ├── es6ImportHandler.ts     # ES6 import handling
│   ├── styleManager.ts         # Style management
│   └── types.d.ts
└── README.md
```

**Dependencies:**
```json
{
  "dependencies": {
    "@clevertree/hook-transpiler": "^0.2.0",
    "@clevertree/themed-styler": "^0.2.0"
  },
  "peerDependencies": {
    "react": "^18.0.0 || ^19.0.0"
  }
}
```

**Files to migrate from `apps/shared/src/`:**
- `index.ts`
- `runtimeLoader.ts`
- `urlBuilder.ts`
- `wasmLoader.ts`
- `es6ImportHandler.ts`
- `simpleJsx.ts`
- `styleManager.ts`
- `themedStylerBridge.ts`
- `themedStylerWasm.ts`
- `unifiedBridge.ts`
- `types.d.ts`

---

### 2.2 `@clevertree/relay-server-shared`

**Purpose:** Shared utilities for Relay server (if needed)

**Package Contents:**
```
relay-server-shared/
├── package.json
├── src/
│   ├── index.ts
│   └── types.ts
└── README.md
```

**Note:** Currently, there's minimal server-side shared code in `apps/shared`. Most server logic is self-contained. This package may not be needed initially, or can be part of the server repo directly.

---

## Phase 3: Create Repository Structure

### 3.1 `relay-server` Repository

```
~/dev/relay-server/
├── Cargo.toml
├── src/
│   └── main.rs
├── crates/
│   └── streaming-files/       # Server-specific crate
├── template/                   # Template system
├── scripts/
├── docker/
├── terraform/
├── docs/
├── README.md
└── package.json               # For development scripts only
```

**Dependencies:**
```toml
[dependencies]
hook-transpiler = { version = "0.2", path = "../hook-transpiler" }  # Dev only
# OR after publishing:
# hook-transpiler = "0.2"
```

**Migration Steps:**
1. `git init ~/dev/relay-server`
2. Copy `apps/server/` → `~/dev/relay-server/src/`
3. Copy `crates/streaming-files/` → `~/dev/relay-server/crates/`
4. Copy `template/` → `~/dev/relay-server/template/`
5. Copy `scripts/` (server-related) → `~/dev/relay-server/scripts/`
6. Copy `docker/` → `~/dev/relay-server/docker/`
7. Copy `terraform/` → `~/dev/relay-server/terraform/`
8. Copy relevant docs from `docs/`
9. Update Cargo.toml to use published npm packages (after Phase 1)
10. Create server-specific README.md

---

### 3.2 `relay-clients` Repository

**Repository Structure:**
```
~/dev/relay-clients/
├── packages/
│   ├── web/                   # Client web (Vite app)
│   │   ├── package.json
│   │   ├── src/
│   │   ├── public/
│   │   └── vite.config.ts
│   ├── mobile/                # React Native app
│   │   ├── package.json
│   │   ├── android/
│   │   ├── ios/
│   │   ├── src/
│   │   └── rust/              # RN native core
│   ├── extension/             # Browser extension
│   │   ├── manifest.json
│   │   └── src/
│   └── shared/                # Client shared (from Phase 2.1)
│       ├── package.json
│       └── src/
├── docs/
├── scripts/
├── package.json               # Workspace root
├── pnpm-workspace.yaml
└── README.md
```

**Root package.json:**
```json
{
  "name": "relay-clients",
  "private": true,
  "version": "1.0.0",
  "workspaces": [
    "packages/*"
  ],
  "scripts": {
    "dev:web": "pnpm --filter web dev",
    "dev:mobile": "pnpm --filter mobile start",
    "build:web": "pnpm --filter web build",
    "build:mobile": "pnpm --filter mobile android",
    "test": "pnpm -r test"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "prettier": "^3.0.0",
    "eslint": "^9.0.0"
  }
}
```

**Migration Steps:**
1. `git init ~/dev/relay-clients`
2. Create monorepo structure with pnpm workspaces
3. Copy `apps/client-web/` → `packages/web/`
4. Copy `apps/client-react-native/` → `packages/mobile/`
5. Copy `apps/extension/` → `packages/extension/`
6. Create `packages/shared/` from split apps/shared (Phase 2.1)
7. Update all package.json files to use:
   - `@clevertree/hook-transpiler`
   - `@clevertree/themed-styler`
   - `@clevertree/relay-client-shared` (workspace package)
8. Update imports across all packages
9. Create clients-specific README.md

---

## Phase 4: Update Dependencies

### 4.1 Client Web Package

**packages/web/package.json:**
```json
{
  "name": "@relay/web-client",
  "dependencies": {
    "@clevertree/hook-transpiler": "^0.2.0",
    "@clevertree/themed-styler": "^0.2.0",
    "@clevertree/relay-client-shared": "workspace:*",
    "react": "^19.2.0",
    "react-dom": "^19.2.0"
  }
}
```

---

### 4.2 React Native Package

**packages/mobile/package.json:**
```json
{
  "name": "@relay/mobile-client",
  "dependencies": {
    "@clevertree/hook-transpiler": "^0.2.0",
    "@clevertree/themed-styler": "^0.2.0",
    "@clevertree/relay-client-shared": "workspace:*",
    "react": "18.2.0",
    "react-native": "0.75.4"
  }
}
```

**React Native Integration:**

1. **Android** (`packages/mobile/android/app/build.gradle`):
```gradle
dependencies {
    // Add as AAR or via gradle plugin from npm package
    implementation "@clevertree/hook-transpiler:android"
    implementation "@clevertree/themed-styler:android"
}
```

2. **iOS** (`packages/mobile/ios/Podfile`):
```ruby
pod 'HookTranspiler', :path => '../node_modules/@clevertree/hook-transpiler/ios'
pod 'ThemedStyler', :path => '../node_modules/@clevertree/themed-styler/ios'
```

3. **Build Scripts:**
```json
{
  "scripts": {
    "postinstall": "npx @clevertree/hook-transpiler build:android && npx @clevertree/themed-styler build:android"
  }
}
```

---

## Phase 5: TypeScript Wrappers for NPM Packages

### 5.1 Hook Transpiler Wrapper

**hook-transpiler/src/index.ts:**
```typescript
// Main entry point - auto-detects environment
export * from './transpiler';
export * from './types';

// Platform-specific exports
export { initWasm, transpileJsx as transpileJsxWasm } from './wasm';
export { transpileJsx as transpileJsxNative } from './native';
```

**hook-transpiler/src/wasm.ts:**
```typescript
import init, { transpile_jsx } from '../wasm/hook_transpiler';

let wasmInitialized = false;

export async function initWasm(wasmUrl?: string): Promise<void> {
  if (wasmInitialized) return;
  
  if (wasmUrl) {
    await init(wasmUrl);
  } else {
    await init();
  }
  
  wasmInitialized = true;
}

export interface TranspileOptions {
  filename?: string;
  sourceMap?: boolean;
}

export interface TranspileResult {
  code: string;
  map?: string;
}

export async function transpileJsx(
  source: string,
  options: TranspileOptions = {}
): Promise<TranspileResult> {
  if (!wasmInitialized) {
    await initWasm();
  }
  
  const result = transpile_jsx(source, options.filename || 'module.jsx');
  return JSON.parse(result);
}
```

**hook-transpiler/src/native.ts:**
```typescript
import { NativeModules } from 'react-native';

const { RustTranspilerModule } = NativeModules;

export interface TranspileOptions {
  filename?: string;
  sourceMap?: boolean;
}

export interface TranspileResult {
  code: string;
  map?: string;
}

export async function transpileJsx(
  source: string,
  options: TranspileOptions = {}
): Promise<TranspileResult> {
  if (!RustTranspilerModule) {
    throw new Error('Native transpiler module not found. Did you link the native module?');
  }
  
  const result = await RustTranspilerModule.transpile(
    source,
    options.filename || 'module.jsx'
  );
  
  return JSON.parse(result);
}
```

---

### 5.2 Themed Styler Wrapper

**themed-styler/src/index.ts:**
```typescript
export * from './styler';
export * from './types';

// Platform-specific exports
export { initWasm, createStyler as createStylerWasm } from './wasm';
export { createStyler as createStylerNative } from './native';
```

**themed-styler/src/wasm.ts:**
```typescript
import init, { State } from '../wasm/themed_styler';

let wasmInitialized = false;

export async function initWasm(wasmUrl?: string): Promise<void> {
  if (wasmInitialized) return;
  
  if (wasmUrl) {
    await init(wasmUrl);
  } else {
    await init();
  }
  
  wasmInitialized = true;
}

export interface StylerOptions {
  theme?: string;
  defaultTheme?: string;
}

export async function createStyler(options: StylerOptions = {}) {
  if (!wasmInitialized) {
    await initWasm();
  }
  
  const state = State.new_default();
  
  if (options.theme) {
    state.set_theme(options.theme);
  }
  
  return {
    registerSelectors: (selectors: string[]) => state.register_selectors(selectors),
    cssForWeb: () => state.css_for_web(),
    rnStylesFor: (selector: string, classes: string[]) => 
      JSON.parse(state.rn_styles_for(selector, classes)),
    setTheme: (theme: string) => state.set_theme(theme),
  };
}
```

---

## Phase 6: Build Automation

### 6.1 WASM Build Scripts

**hook-transpiler/scripts/build-wasm.sh:**
```bash
#!/bin/bash
set -e

echo "Building hook-transpiler WASM..."

# Build WASM
cargo build --release --target wasm32-unknown-unknown --features wasm

# Generate JS bindings
wasm-bindgen \
  --target web \
  --out-dir ./wasm \
  --out-name hook_transpiler \
  target/wasm32-unknown-unknown/release/relay_hook_transpiler.wasm

# Optimize WASM (optional)
if command -v wasm-opt &> /dev/null; then
  wasm-opt -Oz -o ./wasm/hook_transpiler_bg.wasm ./wasm/hook_transpiler_bg.wasm
fi

echo "WASM build complete: ./wasm/"
```

---

### 6.2 Android Build Scripts

**hook-transpiler/scripts/build-android.sh:**
```bash
#!/bin/bash
set -e

echo "Building hook-transpiler for Android..."

# Ensure targets are installed
rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android

# Build for all Android architectures
cargo ndk \
  -t arm64-v8a \
  -t armeabi-v7a \
  -t x86_64 \
  -o ./android/src/main/jniLibs \
  build --release --features android

echo "Android build complete: ./android/src/main/jniLibs/"
```

---

### 6.3 iOS Build Scripts

**hook-transpiler/scripts/build-ios.sh:**
```bash
#!/bin/bash
set -e

echo "Building hook-transpiler for iOS..."

# Ensure targets are installed
rustup target add aarch64-apple-ios x86_64-apple-ios aarch64-apple-ios-sim

# Build for all iOS architectures
cargo build --release --target aarch64-apple-ios
cargo build --release --target x86_64-apple-ios
cargo build --release --target aarch64-apple-ios-sim

# Create XCFramework
xcodebuild -create-xcframework \
  -library target/aarch64-apple-ios/release/librelay_hook_transpiler.a \
  -library target/x86_64-apple-ios/release/librelay_hook_transpiler.a \
  -library target/aarch64-apple-ios-sim/release/librelay_hook_transpiler.a \
  -output ./ios/HookTranspiler.xcframework

echo "iOS build complete: ./ios/HookTranspiler.xcframework/"
```

---

## Phase 7: Migration Execution Plan

### Step-by-Step Execution

#### Step 1: Prepare NPM Packages (Week 1)

1. **Create hook-transpiler package:**
   ```bash
   cd ~/dev
   git clone ~/dev/relay hook-transpiler
   cd hook-transpiler
   git filter-branch --subdirectory-filter crates/hook-transpiler -- --all
   # Clean up and add TypeScript wrappers
   npm init -y
   # Add package.json, TypeScript, build scripts
   ```

2. **Create themed-styler package:**
   ```bash
   cd ~/dev
   git clone ~/dev/relay themed-styler
   cd themed-styler
   git filter-branch --subdirectory-filter crates/themed-styler -- --all
   # Clean up and add TypeScript wrappers
   npm init -y
   # Add package.json, TypeScript, build scripts
   ```

3. **Build and test packages:**
   ```bash
   cd ~/dev/hook-transpiler
   npm run build
   npm test
   
   cd ~/dev/themed-styler
   npm run build
   npm test
   ```

4. **Publish to npm (scoped packages):**
   ```bash
   # Requires npm login with clevertree organization access
   npm login
   
   cd ~/dev/hook-transpiler
   npm publish --access public
   
   cd ~/dev/themed-styler
   npm publish --access public
   ```

---

#### Step 2: Create Client Repository (Week 2)

1. **Initialize repository:**
   ```bash
   cd ~/dev
   mkdir relay-clients
   cd relay-clients
   git init
   pnpm init
   ```

2. **Create workspace structure:**
   ```bash
   mkdir -p packages/{web,mobile,extension,shared}
   ```

3. **Copy and migrate apps:**
   ```bash
   # From ~/dev/relay
   cp -r apps/client-web/* packages/web/
   cp -r apps/client-react-native/* packages/mobile/
   cp -r apps/extension/* packages/extension/
   cp -r apps/shared/* packages/shared/
   ```

4. **Update dependencies:**
   ```bash
   # In each package/*/package.json
   # Replace local path references with:
   # - @clevertree/hook-transpiler: ^0.2.0
   # - @clevertree/themed-styler: ^0.2.0
   # - @clevertree/relay-client-shared: workspace:*
   ```

5. **Install and test:**
   ```bash
   pnpm install
   pnpm run build:web
   pnpm run build:mobile
   ```

---

#### Step 3: Create Server Repository (Week 2-3)

1. **Initialize repository:**
   ```bash
   cd ~/dev
   mkdir relay-server
   cd relay-server
   git init
   cargo init
   ```

2. **Copy server code:**
   ```bash
   cp -r ~/dev/relay/apps/server/* ./
   cp -r ~/dev/relay/crates/streaming-files ./crates/
   cp -r ~/dev/relay/template ./
   cp -r ~/dev/relay/docker ./
   cp -r ~/dev/relay/terraform ./
   ```

3. **Update Cargo.toml:**
   ```toml
   [dependencies]
   # Use published crate or local path during development
   hook-transpiler = "0.2"
   ```

4. **Build and test:**
   ```bash
   cargo build
   cargo test
   cargo run -- serve
   ```

---

#### Step 4: Integration Testing (Week 3-4)

1. **Test web client:**
   ```bash
   cd ~/dev/relay-clients/packages/web
   pnpm dev
   # Verify hook-transpiler WASM loads
   # Verify themed-styler works
   ```

2. **Test React Native:**
   ```bash
   cd ~/dev/relay-clients/packages/mobile
   pnpm android
   # Verify native modules load
   # Test transpilation and styling
   ```

3. **Test server:**
   ```bash
   cd ~/dev/relay-server
   cargo run -- serve
   # Test transpilation endpoint
   # Verify template rendering
   ```

4. **End-to-end testing:**
   - Start server
   - Connect web client
   - Connect mobile client
   - Verify full functionality

---

#### Step 5: Documentation and CI/CD (Week 4)

1. **Update READMEs:**
   - Add installation instructions
   - Document breaking changes
   - Migration guide from monorepo

2. **Set up CI/CD:**
   - GitHub Actions for npm packages
   - Automated WASM builds
   - Automated native module builds
   - Automated testing

3. **Publish documentation:**
   - API documentation
   - Integration guides
   - Example projects

---

## Phase 8: Package Publishing Strategy

### Versioning Strategy

Follow semantic versioning (semver):
- **Major** (X.0.0): Breaking API changes
- **Minor** (0.X.0): New features, backward compatible
- **Patch** (0.0.X): Bug fixes

### Release Process

1. **Development:**
   - Work in feature branches
   - PR to `main` branch
   - CI runs tests and builds

2. **Pre-release:**
   - Tag with `v0.2.0-beta.1`
   - Publish with `npm publish --tag beta`
   - Test in consumer projects

3. **Release:**
   - Tag with `v0.2.0`
   - Publish with `npm publish`
   - Update changelog
   - Create GitHub release

### NPM Scripts for Publishing

**package.json:**
```json
{
  "scripts": {
    "version": "npm run build && npm test",
    "preversion": "npm test",
    "postversion": "git push && git push --tags",
    "prepublishOnly": "npm run build && npm test"
  }
}
```

---

## Migration Checklist

### Pre-Migration
- [ ] Review and update all documentation
- [ ] Identify all dependencies between components
- [ ] Create backup of current monorepo
- [ ] Set up npm organization (@clevertree)
- [ ] Prepare CI/CD pipelines

### NPM Packages
- [ ] Create @clevertree/hook-transpiler repository
- [ ] Add WASM build automation
- [ ] Add Android native module support
- [ ] Add iOS native module support
- [ ] Add TypeScript wrappers
- [ ] Write comprehensive README
- [ ] Publish v0.2.0 to npm

- [ ] Create @clevertree/themed-styler repository
- [ ] Add WASM build automation
- [ ] Add Android native module support
- [ ] Add iOS native module support
- [ ] Add TypeScript wrappers
- [ ] Write comprehensive README
- [ ] Publish v0.2.0 to npm

### Client Repository
- [ ] Create relay-clients monorepo
- [ ] Set up pnpm workspaces
- [ ] Migrate web client
- [ ] Migrate React Native client
- [ ] Migrate browser extension
- [ ] Create shared client library
- [ ] Update all dependencies to use npm packages
- [ ] Test all clients
- [ ] Set up CI/CD

### Server Repository
- [ ] Create relay-server repository
- [ ] Migrate server code
- [ ] Migrate streaming-files crate
- [ ] Migrate template system
- [ ] Update dependencies
- [ ] Test server functionality
- [ ] Set up Docker builds
- [ ] Set up CI/CD

### Post-Migration
- [ ] Archive original monorepo
- [ ] Update all documentation links
- [ ] Announce migration to users
- [ ] Monitor for issues
- [ ] Iterate on feedback

---

## Risk Mitigation

### Risks

1. **Breaking Changes**: Splitting repos may break existing workflows
   - *Mitigation*: Comprehensive testing, migration guides

2. **Dependency Hell**: Managing versions across repos
   - *Mitigation*: Lock files, automated dependency updates

3. **Build Complexity**: Native modules are complex to build
   - *Mitigation*: Automated build scripts, CI/CD

4. **Documentation Drift**: Docs may get out of sync
   - *Mitigation*: Keep docs in code repos, automate doc generation

### Rollback Plan

If migration fails:
1. Original monorepo remains intact as `~/dev/relay`
2. Can continue development in monorepo
3. Individual repos can be deleted/archived
4. npm packages can be deprecated

---

## Timeline

- **Week 1**: Create and publish @clevertree npm packages
- **Week 2**: Create relay-clients repository and migrate
- **Week 3**: Create relay-server repository and migrate
- **Week 4**: Integration testing, documentation, CI/CD
- **Week 5**: Final testing and launch
- **Week 6+**: Monitor, iterate, and support

---

## Success Criteria

### Must Have
- ✅ All npm packages build successfully
- ✅ WASM modules work in browser
- ✅ Native modules work on Android/iOS
- ✅ All clients connect to server
- ✅ Full functionality maintained
- ✅ Documentation complete

### Nice to Have
- Automated releases via CI/CD
- Example projects for each platform
- Performance benchmarks
- Community contributions enabled

---

## Future Considerations

### Additional Packages
- `@clevertree/relay-protocol` - Protocol specification
- `@clevertree/relay-cli` - Command-line tools
- `@clevertree/relay-hooks` - Pre-built hook components

### Monorepo Alternative
Consider using a monorepo tool like Turborepo or Nx for the client repository to better manage the web/mobile/extension packages.

---

## Notes

- Keep original monorepo as `~/dev/relay` for reference
- Use git history preservation techniques (git filter-branch, git subtree)
- Ensure all licenses are properly attributed
- Consider using GitHub Package Registry as alternative to npm
- Plan for gradual migration - can run both old and new in parallel

---

## Conclusion

This plan provides a structured approach to splitting the Relay monorepo into independent repositories while maintaining all functionality through published npm packages. The modular approach allows for:

- Independent versioning and releases
- Easier contribution and maintenance
- Better separation of concerns
- Reusability in other projects
- Clearer ownership and responsibilities

The migration can be done incrementally, testing each step before proceeding to the next.
