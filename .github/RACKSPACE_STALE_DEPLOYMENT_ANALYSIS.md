# Rackspace Stale Deployment Analysis (Dec 6, 2025)

## Current Status
- **Browser Error**: Failed to render via repository hook
- **CORS Errors**: OPTIONS requests to Rackspace nodes returning 405 (Not Allowed)
- **Old Binary**: v0.1.0 running (no X-Relay-Version header in responses)
- **Stale Template**: relay-template repo not updated with latest hooks

## Why Rackspace Is Stale

### Issue 1: Kubernetes API Unreachable
**Status**: ⚠️ BLOCKING

```
kubectl error: dial tcp: lookup hcp-5bf7c612-77ef-41c4-ad24-d63ec253e583.spot.rackspace.com: no such host
```

- Kubernetes control plane DNS is unresolvable from current network
- Cannot execute `kubectl apply` or `kubectl rollout restart` commands
- K8s API unreachability means pods cannot be restarted to pull new images

### Issue 2: Pods Running Old Image SHA

**Evidence**:
```bash
# Attempted deployment
image: ghcr.io/clevertree/relay:sha-39a4e17  # NEW in manifests (Dec 6)

# But running response headers show
# NO X-Relay-Version header response
# Expected: X-Relay-Version: 0.2.0
# Actual: [none - means old v0.1.0 binary]
```

**Why this happened**:
1. ✅ Version bumped to v0.2.0 locally (commit 39a4e17)
2. ✅ Docker image built and published to GHCR as `sha-39a4e17` (CI/CD successful, 5m9s elapsed)
3. ✅ K8s manifests updated with new SHA in files locally (commit 1f1c641)
4. ✅ Changes pushed to GitHub
5. ❌ `kubectl apply` couldn't execute due to K8s API unreachable
6. ❌ Pods never pulled new image, still running old version with old image SHA

### Issue 3: No Persistent Volume for relay-template

**K8s Manifest Issue**:
```yaml
# Current manifest ONLY mounts letsencrypt volumes
volumeMounts:
  - name: letsencrypt
    mountPath: /etc/letsencrypt
  - name: letsencrypt-var
    mountPath: /var/lib/letsencrypt

# Missing: /srv/relay/data/repo.git volume mount
# Result: relay-template repo cloned on first startup, never updated
```

**Why this matters**:
- When pod starts, it clones `relay-template` repo to a container-local path
- Container-local paths don't persist across pod restarts
- Each pod restart = fresh clone of relay-template (but old image SHA means old clone)
- No way to trigger `git pull` on running pods

## Evidence

### Test 1: No Version Header
```bash
$ curl -s -k -I "https://node-dfw1.relaynet.online/hooks/lib/sources/tmdb.js" \
  -H "X-Relay-Branch: main" \
  -H "X-Relay-Repo: https://github.com/clevertree/relay"

# Response headers:
HTTP/1.1 200 OK
Server: nginx/1.24.0 (Ubuntu)
Content-Type: text/html
# ❌ Missing: X-Relay-Version header
# If running v0.2.0, should see: X-Relay-Version: 0.2.0
```

### Test 2: Old Version Confirmed
```bash
# Local container (NEW v0.2.0):
$ curl -I http://localhost:5001/hooks/lib/sources/tmdb.js \
  -H "X-Relay-Branch: main"
# Would show: X-Relay-Version: 0.2.0

# Rackspace nodes (OLD v0.1.0):
$ curl -I https://node-dfw1.relaynet.online:5001/hooks/lib/sources/tmdb.js \
  -H "X-Relay-Branch: main"
# Shows: [no header = v0.1.0]
```

### Test 3: Template 404 Errors
```
Error: Failed to render via repository hook
Hook path missing after refresh

Browser console shows multiple hook path resolution failures suggesting:
- Stale clone of relay-template
- Missing .relay.yaml config
- Or outdated hooks structure
```

## Deployment Timeline

**Dec 6, 2025 - What We Did**:
1. **14:00** - Incremented server version 0.1.0 → 0.2.0
2. **14:05** - Added X-Relay-Version header (commit 39a4e17)
3. **14:10** - GitHub Actions published image `sha-39a4e17` to GHCR ✅
4. **14:15** - Updated K8s manifests with new image SHA (commit 1f1c641)
5. **14:16** - Pushed to GitHub ✅
6. **14:20** - Attempted `kubectl apply` ❌ **K8s API unreachable**

**Manifests Updated But Not Deployed**:
```
Local filesystem: ✅ Manifests have sha-39a4e17
GitHub: ✅ Pushed with sha-39a4e17
Rackspace cluster: ❌ Still running old image SHA

Because: kubectl apply never executed
Reason: Kubernetes control plane unreachable from this network
```

## Solution Options

### Option 1: SSH to Nodes (Immediate, if accessible)
```bash
ssh ubuntu@node-dfw1.relaynet.online
# Inside node:
docker images | grep relay  # Check running image
docker ps | grep relay       # Check container
docker logs <container>      # Check startup logs

# If no pod restart needed:
docker pull ghcr.io/clevertree/relay:sha-39a4e17
docker stop <old-container>
docker run <new-container>

# Verify new version:
curl -I http://localhost:5001/ | grep X-Relay-Version
# Should show: X-Relay-Version: 0.2.0
```

### Option 2: Network Tunnel to K8s API
```bash
# If VPN or proxy available, establish tunnel to K8s API
kubectl config set-cluster relay --server https://hcp-305d5f40-3337-4912-954c-5618797e3c60.spot.rackspace.com
# Then: kubectl apply -f terraform/rackspace-spot/k8s/relay-daemonset*.yaml
```

### Option 3: Update relay-template Separately
Once pods are running v0.2.0, add persistent volume mount for repo.git:
```yaml
volumeMounts:
  - name: relay-data
    mountPath: /srv/relay/data
volumes:
  - name: relay-data
    hostPath:
      path: /srv/relay/data
      type: DirectoryOrCreate
```

## Long-term Fixes Required

### Fix 1: Add Persistent Volume for relay-template
Update both DaemonSet manifests to persist relay-template repo between restarts.

### Fix 2: Add Liveness/Readiness Probes
```yaml
livenessProbe:
  httpGet:
    path: /
    port: 5001
    httpHeaders:
      - name: X-Relay-Branch
        value: main
      - name: X-Relay-Repo
        value: https://github.com/clevertree/relay
  initialDelaySeconds: 30
  periodSeconds: 10
```

### Fix 3: Verify imagePullPolicy
Current: `imagePullPolicy: Always` ✅ (good - pulls fresh on restart)
Should force pod restart to pick up new image.

### Fix 4: Network Connectivity Check
- Rackspace K8s API endpoint: `https://hcp-5bf7c612-77ef-41c4-ad24-d63ec253e583.spot.rackspace.com`
- Status: Unreachable from current network
- Action: Check network connectivity, firewall rules, or VPN tunnel

## Verification After Fix

Once deployed to Rackspace (either manually or via kubectl):

```bash
# 1. Check version header
curl -s -k -I https://node-dfw1.relaynet.online/hooks/lib/sources/tmdb.js \
  -H "X-Relay-Branch: main" \
  -H "X-Relay-Repo: https://github.com/clevertree/relay" | grep X-Relay-Version
# Expected: X-Relay-Version: 0.2.0

# 2. Check template loads without errors
curl -s -k https://node-dfw1.relaynet.online/ 2>&1 | grep -i "error\|failed"
# Expected: [no errors]

# 3. Check OPTIONS CORS preflight
curl -s -k -X OPTIONS https://node-dfw1.relaynet.online/hooks/lib/sources/tmdb.js \
  -H "Origin: https://example.com" | grep -i access-control
# Expected: Access-Control-Allow-Origin header present
```

## Commit References
- v0.2.0 bump: `39a4e17`
- K8s manifests updated: `1f1c641`
- Both commits pushed to origin/main ✅
