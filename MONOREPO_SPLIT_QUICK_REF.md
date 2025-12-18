# Monorepo Split - Quick Reference

## Repository Structure (Target)

```
~/dev/
├── relay/                              # Original (archive/reference)
├── hook-transpiler/                    # @clevertree/hook-transpiler
├── themed-styler/                      # @clevertree/themed-styler
├── relay-server/                       # Server repository
└── relay-clients/                      # Clients monorepo
    ├── packages/
    │   ├── web/                        # Vite web client
    │   ├── mobile/                     # React Native
    │   ├── extension/                  # Browser extension
    │   └── shared/                     # @clevertree/relay-client-shared
    └── pnpm-workspace.yaml
```

## NPM Packages to Publish

### @clevertree/hook-transpiler (v0.2.0)
- **Source**: `crates/hook-transpiler/`
- **Includes**: WASM, Android/iOS native modules
- **Exports**: 
  - Main: TypeScript wrapper
  - `/wasm`: WASM module
  - `/android`: Gradle integration
  - `/ios`: XCFramework

### @clevertree/themed-styler (v0.2.0)
- **Source**: `crates/themed-styler/`
- **Includes**: WASM, Android/iOS native modules
- **Exports**:
  - Main: TypeScript wrapper
  - `/wasm`: WASM module
  - `/android`: Gradle integration
  - `/ios`: XCFramework
  - `/theme`: Default theme.yaml

## Migration Order

1. **Week 1**: Create and publish npm packages
   ```bash
   cd ~/dev/hook-transpiler && npm publish
   cd ~/dev/themed-styler && npm publish
   ```

2. **Week 2**: Create relay-clients repo
   ```bash
   cd ~/dev/relay-clients
   pnpm install
   pnpm run build:web
   pnpm run build:mobile
   ```

3. **Week 3**: Create relay-server repo
   ```bash
   cd ~/dev/relay-server
   cargo build
   cargo test
   ```

4. **Week 4**: Integration testing and CI/CD

## Key Commands

### Build NPM Packages
```bash
# hook-transpiler
npm run build          # Build all (WASM + types)
npm run build:wasm     # Build WASM only
npm run build:android  # Build Android native
npm run build:ios      # Build iOS native

# themed-styler (same commands)
```

### Client Workspace
```bash
cd ~/dev/relay-clients

# Development
pnpm dev:web          # Start web dev server
pnpm dev:mobile       # Start React Native Metro

# Build
pnpm build:web        # Build web for production
pnpm build:mobile     # Build Android APK

# Test
pnpm test             # Run all tests
```

### Server
```bash
cd ~/dev/relay-server

# Development
cargo run -- serve

# Build
cargo build --release

# Test
cargo test

# Docker
docker build -t relay-server .
```

## Package Dependencies

### Web Client
```json
{
  "dependencies": {
    "@clevertree/hook-transpiler": "^0.2.0",
    "@clevertree/themed-styler": "^0.2.0",
    "@clevertree/relay-client-shared": "workspace:*"
  }
}
```

### React Native Client
```json
{
  "dependencies": {
    "@clevertree/hook-transpiler": "^0.2.0",
    "@clevertree/themed-styler": "^0.2.0",
    "@clevertree/relay-client-shared": "workspace:*"
  }
}
```

### Server
```toml
[dependencies]
hook-transpiler = "0.2"
```

## Native Module Integration

### Android (React Native)
```gradle
// android/app/build.gradle
dependencies {
    implementation "@clevertree/hook-transpiler:android"
    implementation "@clevertree/themed-styler:android"
}
```

### iOS (React Native)
```ruby
# ios/Podfile
pod 'HookTranspiler', :path => '../node_modules/@clevertree/hook-transpiler/ios'
pod 'ThemedStyler', :path => '../node_modules/@clevertree/themed-styler/ios'
```

## Files to Migrate

### hook-transpiler
- All of `crates/hook-transpiler/`
- Build scripts from `scripts/build-hook-wasm.sh`, `scripts/*-prepare-hook-transpiler.sh`
- Add TypeScript wrappers (new)
- Add package.json (new)

### themed-styler
- All of `crates/themed-styler/`
- Build scripts from `scripts/*-prepare-themed-styler.sh`
- Add TypeScript wrappers (new)
- Add package.json (new)

### relay-clients
- `apps/client-web/` → `packages/web/`
- `apps/client-react-native/` → `packages/mobile/`
- `apps/extension/` → `packages/extension/`
- `apps/shared/` → `packages/shared/` (client parts only)

### relay-server
- `apps/server/` → `src/`
- `crates/streaming-files/` → `crates/streaming-files/`
- `template/` → `template/`
- `docker/` → `docker/`
- `terraform/` → `terraform/`
- Server-related docs

## Testing Checklist

### NPM Packages
- [ ] WASM builds and loads in browser
- [ ] Android native module builds (.so files)
- [ ] iOS native module builds (.xcframework)
- [ ] TypeScript types work correctly
- [ ] Examples run successfully

### Clients
- [ ] Web client builds and runs
- [ ] React Native builds and runs (Android)
- [ ] React Native builds and runs (iOS)
- [ ] Extension loads in browser
- [ ] All clients can connect to server

### Server
- [ ] Server builds and runs
- [ ] Transpilation endpoint works
- [ ] Template rendering works
- [ ] Docker image builds
- [ ] All e2e tests pass

## Rollback Strategy

Original monorepo remains at `~/dev/relay`:
- Keep as backup and reference
- Can continue development if migration fails
- Git history preserved in all new repos
- npm packages can be unpublished within 72 hours

## Critical Success Factors

1. ✅ WASM and native modules build correctly
2. ✅ All platforms tested (Web, Android, iOS)
3. ✅ No functionality lost in migration
4. ✅ Documentation updated
5. ✅ CI/CD pipelines working
6. ✅ Team trained on new structure

## Support & Resources

- **Full Plan**: `MONOREPO_SPLIT_PLAN.md`
- **Current Structure**: `README.md`
- **Documentation**: `docs/README.md`
- **Issues**: Track in GitHub Issues for each repo

## Timeline Summary

| Week | Tasks | Deliverables |
|------|-------|--------------|
| 1 | Create npm packages | Published @clevertree packages |
| 2 | Create client repo | relay-clients working |
| 3 | Create server repo | relay-server working |
| 4 | Testing & CI/CD | All tests passing |
| 5 | Final testing | Ready for launch |
| 6+ | Monitor & support | Stable operation |
