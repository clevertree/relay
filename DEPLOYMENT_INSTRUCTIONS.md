# Relay Deployment Instructions

## Status: READY TO DEPLOY ✅

### What's Been Completed:

1. **Web Client Text Visibility Fixed**
   - Updated color contrast in:
     - `apps/client-web/src/App.css`
     - `apps/client-web/src/components/PeersView.css`
     - `apps/client-web/src/components/TabBar.css`
   - Changed faint text `rgba(0, 0, 0, 0.5)` to darker `rgba(0, 0, 0, 0.8)`

2. **Git & Container Registry**
   - ✅ Committed changes: `93ea918`
   - ✅ Tagged release: `v0.1.0-web-client`
   - ✅ Pushed to GitHub
   - ✅ Docker image built and pushed to GHCR
   - ✅ Image available at: `ghcr.io/clevertree/relay:sha-93ea918`

3. **Kubernetes Manifests Updated**
   - Updated `terraform/rackspace-spot/k8s/relay-daemonset.yaml`
   - Updated `terraform/rackspace-spot/k8s/relay-daemonset-dfw2.yaml`
   - Both now reference image: `ghcr.io/clevertree/relay:sha-93ea918`
   - Changes committed and pushed to main branch

### How to Deploy to Rackspace:

Run this from a machine with access to the Rackspace k8s cluster:

```bash
cd terraform/rackspace-spot/k8s

# Apply the updated daemonsets
kubectl apply -f relay-daemonset.yaml
kubectl apply -f relay-daemonset-dfw2.yaml

# Restart the daemonsets to pull new image
kubectl rollout restart daemonset/relay-daemon -n default
kubectl rollout restart daemonset/relay-daemon-dfw2 -n default

# Verify rollout status
kubectl rollout status daemonset/relay-daemon
kubectl rollout status daemonset/relay-daemon-dfw2

# Check pod status
kubectl get pods -l app=relay
kubectl get pods -l app=relay-dfw2
```

### Verification Commands:

```bash
# Check that new image is running
kubectl describe pod -l app=relay | grep Image

# View logs
kubectl logs -l app=relay -f --tail=100
kubectl logs -l app=relay-dfw2 -f --tail=100

# Check service endpoints
kubectl get endpoints relay-service
```

### Rollback (if needed):

```bash
git checkout HEAD~1 -- terraform/rackspace-spot/k8s/
kubectl apply -f terraform/rackspace-spot/k8s/relay-daemonset.yaml
kubectl apply -f terraform/rackspace-spot/k8s/relay-daemonset-dfw2.yaml
kubectl rollout restart daemonset/relay-daemon
kubectl rollout restart daemonset/relay-daemon-dfw2
```

---

## Key Changes in This Release:

- **Web Client UI**: Text is now more visible with improved contrast
- **Container**: All changes baked into `ghcr.io/clevertree/relay:sha-93ea918`
- **CORS**: Server configured to allow cross-origin requests
- **Environment Variables**: Web client reads `VITE_RELAY_MASTER_PEER_LIST` from `.env`

## Git Commits:

```
c4166d7 Deploy: Update Rackspace k8s manifests to new image sha-93ea918
93ea918 UI: Fix text visibility in web client - improve color contrast
```

## Image Details:

- **Repository**: `ghcr.io/clevertree/relay`
- **Tags**:
  - `sha-93ea918` (primary)
  - `v0.1.0-web-client` (release)
  - `latest` (auto-updated)
- **Built from**: Commit `93ea918`
- **Size**: ~201MB gzipped

---

**Next Steps**: Execute the deployment commands above on a machine with k8s cluster access.
