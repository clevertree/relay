# Update Relay Template on Live Nodes

This guide explains how to pull the latest relay-template repo on the live Rackspace relay nodes.

## Problem

The Rackspace nodes are currently serving an **out-of-date version** of the relay-template repo because:

1. **No persistent volume** for git data - repo is in ephemeral container storage
2. **Pinned Docker images** - old commit hashes in K8s manifests
3. **No automatic updates** - only clones on first container startup

## Solution: Pull Latest Template

Once you have network access to the Rackspace cluster, run these commands:

### Quick Update (Fetch only)

```bash
# Update DFW1 node
kubectl exec -n default -it deployment/relay-daemon -- sh -c 'git -C /srv/relay/data/repo.git fetch --all --prune && echo "✓ DFW1 updated"'

# Update DFW2 node
kubectl exec -n default -it deployment/relay-daemon-dfw2 -- sh -c 'git -C /srv/relay/data/repo.git fetch --all --prune && echo "✓ DFW2 updated"'
```

### Full Reclone (If repo is corrupted)

```bash
# Backup and reclone on DFW1
kubectl exec -n default -it deployment/relay-daemon -- sh -c '
  mv /srv/relay/data/repo.git /srv/relay/data/repo.git.bak.$(date +%s) || true
  git clone --bare https://github.com/clevertree/relay-template /srv/relay/data/repo.git
  echo "✓ DFW1 recloned"
'

# Backup and reclone on DFW2
kubectl exec -n default -it deployment/relay-daemon-dfw2 -- sh -c '
  mv /srv/relay/data/repo.git /srv/relay/data/repo.git.bak.$(date +%s) || true
  git clone --bare https://github.com/clevertree/relay-template /srv/relay/data/repo.git
  echo "✓ DFW2 recloned"
'
```

### Automated Script

Or use the provided script (once cluster is accessible):

```bash
./scripts/update-relay-template.sh
```

## Verify Updates

Check the current HEAD of the repo on each node:

```bash
# Check DFW1
kubectl exec deployment/relay-daemon -- git -C /srv/relay/data/repo.git log --oneline -1

# Check DFW2
kubectl exec deployment/relay-daemon-dfw2 -- git -C /srv/relay/data/repo.git log --oneline -1
```

## Long-term Fix

To prevent this from happening again, update the K8s manifests:

1. **Add persistent volume** for `/srv/relay/data`
2. **Use latest image tag** instead of pinned commit hashes
3. **Set RELAY_TEMPLATE_URL** environment variable to your desired repo

See the updated manifests in `terraform/rackspace-spot/k8s/`.

## Current Status

- **Cluster Accessible**: ❌ (DNS lookup failing)
- **Network Required**: VPN or network connectivity to Rackspace cluster
- **Urgency**: High - live nodes are serving outdated template

Once you can access the cluster, run the commands above to update the live nodes.
