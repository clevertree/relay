# E2E Test Suite - Complete Documentation Index

## 🎯 Start Here

**Problem**: Deployed servers not serving README.md from git repositories

**Solution**: Use these tests to diagnose whether it's a code bug or a deployment issue

---

## 📚 Documentation Guide

### For Quick Start (2 minutes)
👉 **[E2E_TESTS_QUICK_REFERENCE.md](./E2E_TESTS_QUICK_REFERENCE.md)**
- Quick test descriptions
- How to run each test
- What results mean
- Expected outputs

### For Complete Overview (5 minutes)
👉 **[E2E_TEST_SUITE_README.md](./E2E_TEST_SUITE_README.md)**
- Full test suite overview
- How to use tests for diagnosis
- Debugging workflow
- Requirements and setup

### For Implementation Details (10 minutes)
👉 **[IMPLEMENTATION_COMPLETE.md](./IMPLEMENTATION_COMPLETE.md)**
- What was created
- File inventory
- Technical architecture
- Usage examples

### For Local Test Details (5 minutes)
👉 **[scripts/e2e/test-local-file-serving-README.md](./scripts/e2e/test-local-file-serving-README.md)**
- Local test overview
- Test coverage details
- Debugging failed tests
- Manual verification steps

### For Master Peers Test Details (5 minutes)
👉 **[scripts/e2e/test-master-peers-README.md](./scripts/e2e/test-master-peers-README.md)**
- Master peers test overview
- Test coverage details
- Understanding results
- Troubleshooting

---

## 🚀 Running the Tests

### Test 1: Local Server File Serving
```bash
npm run test:e2e:local
```
**Purpose**: See if your server code can serve README.md
**Time**: ~3-5 minutes first time, ~30 seconds after
**Result**: ✓ PASS = code is fine, ✗ FAIL = code has bug

### Test 2: Deployed Master Nodes
```bash
npm run test:e2e:peers
```
**Purpose**: Check which deployed nodes work
**Time**: ~1-2 minutes
**Result**: Shows which nodes serve README.md and which don't

---

## 📊 Diagnostic Workflow

```
Start: README.md not serving on deployed servers

        ↓
    
    Run: npm run test:e2e:local
    
    ┌─────────────┬─────────────┐
    ↓             ↓
  PASS          FAIL
    ↓             ↓
  Issue is    Issue is
  deployment  in server
  config        code
    ↓             ↓
  Run:         Fix:
  npm run      Look at
  test:e2e     server
  :peers       output
    ↓             ↓
  Check       Run local
  which       test
  nodes fail  again
    ↓
  Compare
  working vs
  failing
  nodes
```

---

## 🎓 Understanding Results

### Local Test Results

**✓ All tests pass**
- ✓ Your server code is working
- ✓ File serving logic is correct
- ✗ Problem is in deployment/configuration
- **Next**: Run `npm run test:e2e:peers` to check deployed nodes

**✗ Some tests fail**
- ✗ Your server has a file serving bug
- ✓ Look at server output capture in the test
- **Next**: Fix the bug in server code

### Master Peers Test Results

**✓ Nodes pass README.md test**
- ✓ That node is properly configured
- ✓ Git repository is accessible
- ✓ File serving is working on that node

**✗ Nodes fail README.md test**
- ✗ That node has an issue
- ✗ Could be: git repo not cloned, permissions, config
- **Next**: Check deployment on that specific node

---

## 🔍 Files Created

### Test Scripts
```
scripts/e2e/
├── test-local-file-serving.mjs       (9.6 KB)
└── test-master-peers.mjs             (10.7 KB)
```

### Documentation
```
scripts/e2e/
├── test-local-file-serving-README.md (7.2 KB)
└── test-master-peers-README.md       (5.1 KB)

root/
├── E2E_TEST_SUITE_README.md          (7.0 KB)
├── E2E_TESTS_QUICK_REFERENCE.md      (4.0 KB)
├── IMPLEMENTATION_COMPLETE.md        (7.5 KB)
└── E2E_DOCUMENTATION_INDEX.md        (this file)
```

### Configuration
```
package.json (updated with 2 new scripts)
```

---

## 🎯 Decision Tree

### "Is it a server code bug?"
```
Run: npm run test:e2e:local
↓
PASS? → Not a code bug, check deployment
FAIL? → Yes, it's a code bug, fix server
```

### "Which deployed nodes have issues?"
```
Run: npm run test:e2e:peers
↓
See which nodes: NOT serving README.md
Compare with: nodes that ARE serving README.md
Investigate differences between working/broken
```

### "Why isn't README.md being served?"
```
Options:
1. Server code bug          → local test will fail
2. Git repo not cloned      → check RELAY_REPO_PATH on server
3. Permissions issue        → check git object permissions
4. Git config wrong         → check .git/config
5. Network/firewall         → check connectivity to git host
6. File doesn't exist       → check relay-template repo has README.md
```

---

## 💡 Tips for Debugging

### If local test fails, check:
1. Server output capture (printed to console)
2. Look for panic messages or error lines
3. Check if RELAY_REPO_PATH is set correctly
4. Try running server manually:
   ```bash
   RELAY_REPO_PATH=tmp/e2e-local-server-test/relay-template.git \
   cargo run --manifest-path apps/server/Cargo.toml -- serve
   ```

### If master peers test shows failures:
1. Which specific nodes fail? (test shows status per node)
2. Does the node respond to HTTP at all?
3. Are OPTIONS headers present?
4. Is it just README.md or all files?
5. Compare server config between working and broken nodes

### If tests hang or timeout:
1. Check port 8088 isn't already in use
2. Check network connectivity (master peers test)
3. Try manual curl requests to the nodes
4. Check if server is stuck (look at server output)

---

## ✅ Next Steps

1. **Read the quick reference**:
   ```bash
   cat E2E_TESTS_QUICK_REFERENCE.md
   ```

2. **Run the local test**:
   ```bash
   npm run test:e2e:local
   ```

3. **Interpret the results** using the diagnostic workflow above

4. **If local passes**: Run master peers test
   ```bash
   npm run test:e2e:peers
   ```

5. **If local fails**: Check server output and fix the bug

6. **Share results** with your team including:
   - Full test output
   - Server output (if there are errors)
   - Which nodes fail (if running peers test)

---

## 📞 Questions?

Each test has detailed documentation:
- Local test: `scripts/e2e/test-local-file-serving-README.md`
- Master peers: `scripts/e2e/test-master-peers-README.md`
- Full suite: `E2E_TEST_SUITE_README.md`

All files are comprehensive with examples, troubleshooting, and explanations.

---

## ✨ Summary

You now have:
- ✓ 2 comprehensive E2E tests
- ✓ 4 detailed documentation files
- ✓ Clear diagnostic workflow
- ✓ Ready-to-run commands

**Everything is ready to use immediately to diagnose the README.md serving issue!**

```bash
npm run test:e2e:local    # Start here
```
