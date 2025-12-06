# Rackspace v0.2.0 Deployment Complete ✅

**Date**: December 6, 2025  
**Status**: ✅ Successfully Deployed  
**Verified**: Both DFW1 and DFW2 nodes running v0.2.0  

## Deployment Summary

### What Was Deployed
- **Binary Version**: v0.2.0 (was v0.1.0)
- **Image SHA**: `sha-3f03125` 
- **Version Header**: `X-Relay-Version: 0.2.0` now included in all responses
- **Nodes Updated**: 
  - ✅ node-dfw1.relaynet.online
  - ✅ node-dfw2.relaynet.online

### Commits in This Deployment

| Commit | Message | Status |
|--------|---------|--------|
| 39a4e17 | Increment server version to 0.2.0 and add X-Relay-Version header | ✅ Initial implementation |
| 3f03125 | Fix header name parsing in cors_headers function | ✅ Bug fix (panic on startup) |
| edc833e | Update K8s manifests with corrected image SHA sha-3f03125 | ✅ Final deployment |

### Verification Tests

#### Test 1: Version Header Present on DFW1
```bash
$ curl -s -k -I "https://node-dfw1.relaynet.online/hooks/lib/sources/tmdb.js" \
  -H "X-Relay-Branch: main" \
  -H "X-Relay-Repo: https://github.com/clevertree/relay"

HTTP/1.1 404 Not Found
Server: nginx/1.24.0 (Ubuntu)
...
x-relay-version: 0.2.0  ✅
```

#### Test 2: Version Header Present on DFW2
```bash
$ curl -s -k -I "https://node-dfw2.relaynet.online/hooks/lib/sources/tmdb.js" \
  -H "X-Relay-Branch: main" \
  -H "X-Relay-Repo: https://github.com/clevertree/relay"

HTTP/1.1 404 Not Found
...
x-relay-version: 0.2.0  ✅
```

#### Test 3: Kubernetes DaemonSets Status
```bash
$ kubectl get daemonsets -o wide

NAME                DESIRED   CURRENT   READY   IMAGES                             
relay-daemon        1         1         1       ghcr.io/clevertree/relay:sha-3f03125 ✅
relay-daemon-dfw2   1         1         1       ghcr.io/clevertree/relay:sha-3f03125 ✅
```

## Issues Fixed Along the Way

### Issue 1: Header Name Panic (Commit 3f03125)
**Problem**: Server crashed on startup with:
```
thread 'tokio-runtime-worker' panicked at 
  /usr/local/cargo/registry/src/.../http-1.3.1/src/header/name.rs:1281:13
  index out of bounds: the len is 0 but the index is 0
```

**Root Cause**: Using `HeaderName::from_static(HEADER_VERSION)` where `HEADER_VERSION = "X-Relay-Version"` was being incorrectly parsed.

**Solution**: Changed to safely parse header name from bytes:
```rust
if let Ok(version_name) = axum::http::header::HeaderName::from_bytes(b"x-relay-version") {
    headers.insert(version_name, version_value);
}
```

**Result**: ✅ Server no longer panics, header inserted successfully

### Issue 2: K8s API Connectivity (Fixed with correct kubeconfig)
**Problem**: Could not reach Rackspace K8s API initially  
**Solution**: Used `relay-kubeconfig (2).yaml` with correct server endpoint  
**Result**: ✅ Able to apply manifests and restart pods

## Deployment Flow

```
Local code change (v0.2.0)
    ↓
Commit & push to GitHub
    ↓
GitHub Actions builds & publishes to GHCR (sha-3f03125)
    ↓
Update K8s manifests with new image SHA
    ↓
kubectl apply -f manifests
    ↓
kubectl rollout restart daemonsets
    ↓
Pods pull new image: sha-3f03125
    ↓
Relay server starts with new code (includes version header)
    ↓
✅ Version header verified on both nodes
```

## What Changed in v0.2.0

### Code Changes
- Added `X-Relay-Version` header to all HTTP responses
- Header value: Embedded from `CARGO_PKG_VERSION` at compile time
- Safe header name parsing with proper error handling

### User Impact
- ✅ Can now query header to verify which version is running
- ✅ Better debugging and deployment tracking
- ✅ No functional changes to relay behavior

## Next Steps

### Optional Improvements
1. Add persistent volume for `/srv/relay/data/repo.git` in K8s manifests to prevent stale template clones
2. Add liveness/readiness probes to K8s manifests for better pod health monitoring
3. Document deployment procedure in DEPLOYMENT.md

### Monitoring
- Watch `x-relay-version` header responses to track deployments
- Monitor pod logs for any issues: `kubectl logs -f deployment/relay-daemon`
- Use Rackspace DNS for load balancing: both nodes running same version

## References
- K8s Manifests: `terraform/rackspace-spot/k8s/relay-daemonset*.yaml`
- Server Code: `apps/server/src/main.rs` (cors_headers function)
- Analysis Document: `.github/RACKSPACE_STALE_DEPLOYMENT_ANALYSIS.md`
- Local Testing: Verified working on localhost:5001 with v0.2.0

---

**Deployment completed successfully at ~19:41 UTC on Dec 6, 2025**
