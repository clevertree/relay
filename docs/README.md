# Relay Project Documentation

**Last Updated**: December 17, 2025

This directory contains the core documentation for the Relay project. For the main project overview and quick start guide, see the [root README](../README.md).

---

## 📚 Core Documentation

### Project Foundation
- [**Project Vision**](relay_project_vision.md) - Philosophy, goals, and architecture principles
- [**Configuration Guide**](relay-yaml-configuration.md) - Complete `.relay.yaml` reference
- [**Web Client Architecture**](web-client-architecture.md) - Web client design and implementation
- [**Plugin Interface**](plugin-interface.md) - Plugin system architecture

### Implementation Guides
- [**Hook Transpiler**](hook-transpiler-plan.md) - JSX/TSX transpilation system
- [**Distributed File Loader**](DISTRIBUTED_FILE_LOADER.md) - Distributed file loading architecture
- [**Cross-Platform Video**](CROSS_PLATFORM_VIDEO_IMPLEMENTATION.md) - Video player implementation
- [**React Native Video**](REACT_NATIVE_VIDEO_IMPLEMENTATION.md) - React Native video guide

---

## 🔧 Repository Features

### Git & Version Control
- [**Git Branch Rules**](git-branch-rules.md) - Branch/merge/commit rule system
- [**Repo Script System**](repo-script-system.md) - Script-driven repository logic
- [**Pre-commit Hooks**](pre-commit.md) - Pre-commit hook setup

---

## 📱 Platform-Specific

### Android
- [**Android Signing Setup**](ANDROID_SIGNING_SETUP.md) - APK signing configuration
- [**Android Key Management**](android-signing-key-management.md) - Key management strategies
- [**Android Internet Debug**](ANDROID_INTERNET_DEBUG.md) - Network debugging guide

### React Native
- [**React Native Client**](../apps/client-react-native/README.md) - RN app documentation
- [**Android Build Guide**](../apps/client-react-native/docs/ANDROID_BUILD.md) - Detailed build instructions
- [**Module Loading**](../apps/client-react-native/docs/MODULE_LOADING.md) - Module loading system
- [**Plugin System**](../apps/client-react-native/docs/T6_DECLARATIVE_PLUGIN.md) - Declarative plugins

---

## 🚀 Operations & Deployment

### Development
- [**Dev Server Setup**](DEV_SERVER_README.md) - Development server configuration
- [**Port Mappings**](PORT_MAPPINGS.md) - Container port configuration

### Deployment & Release
- [**Deployment Instructions**](DEPLOYMENT_INSTRUCTIONS.md) - Production deployment guide
- [**Update Template**](UPDATE-RELAY-TEMPLATE.md) - Template update procedures
- [**Release Validation**](RELEASE_VALIDATION.md) - Release checklist

### Testing
- [**E2E Tests Quick Reference**](E2E_TESTS_QUICK_REFERENCE.md) - E2E testing guide
- [**E2E Test Suite**](E2E_TEST_SUITE_README.md) - Complete test suite documentation

---

## 🏗️ Infrastructure

- [**Infrastructure Plan**](infra/plan.md) - Cloud infrastructure and deployment strategy

---

## 📦 Crate-Specific Documentation

### Rust Crates
- [**hook-transpiler**](../crates/hook-transpiler/README.md) - JSX/TSX transpiler
- [**themed-styler**](../crates/themed-styler/README.md) - Runtime styling engine
- [**streaming-files**](../crates/streaming-files/README.md) - File streaming system
- [**relay-lib**](../crates/relay-lib/README.md) - ⚠️ Legacy library (being phased out)

### Applications
- [**Server**](../apps/server/README.md) - Relay server implementation
- [**Client Web**](../apps/client-web/README.md) - Web client
- [**Extension**](../apps/extension/README.md) - Browser extension

---

## 📋 Documentation Standards

### File Organization
- **Active Documentation**: All current, maintained docs are in `/docs`
- **Historical Archive**: Completed session reports and old docs are in `/archive/docs`
- **App-Specific**: App-specific docs stay in their respective app directories

### Naming Conventions
- `UPPERCASE_SNAKE_CASE.md` - Implementation guides and technical documents
- `lowercase-kebab-case.md` - Configuration, standards, and reference docs
- `README.md` - Overview and getting started for each component

### Maintenance
- Update "Last Updated" dates when making significant changes
- Keep docs concise - link to code or external resources for deep details
- Archive obsolete docs rather than deleting them

---

## 🗂️ Archive

Historical documentation and session reports are preserved in:
- `/archive/docs/session-reports` - Debugging and implementation sessions
- `/archive/docs/rn-implementation` - React Native implementation reports
- `/archive/docs/root-completion` - Project completion reports

---

## 🤝 Contributing to Documentation

When adding new documentation:

1. **Determine the right location**:
   - Core project concepts → `/docs`
   - App-specific details → `apps/{app-name}/docs/`
   - Crate-specific → `crates/{crate-name}/`

2. **Follow naming conventions** (see above)

3. **Update this index** when adding major new documentation

4. **Link liberally** - documentation should form a connected web

5. **Keep it current** - archive outdated docs rather than leaving them to rot

---

## 📞 Getting Help

- **General Questions**: See [root README](../README.md)
- **Development Issues**: Check [Dev Server Setup](DEV_SERVER_README.md)
- **Deployment Issues**: See [Deployment Instructions](DEPLOYMENT_INSTRUCTIONS.md)
- **Android Build Issues**: See [Android Build Guide](../apps/client-react-native/docs/ANDROID_BUILD.md)
