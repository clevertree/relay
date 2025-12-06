#!/bin/bash
# Update relay-template on live Rackspace relay nodes
# 
# Usage: ./scripts/update-relay-template.sh
# 
# This script will:
# 1. Execute on all relay daemon pods running on Rackspace
# 2. Pull the latest git from https://github.com/clevertree/relay-template
# 3. Update the repo served by relay-server

set -e

TEMPLATE_REPO_URL="${RELAY_TEMPLATE_URL:-https://github.com/clevertree/relay-template}"
RELAY_REPO_PATH="${RELAY_REPO_PATH:-/srv/relay/data/repo.git}"

echo "🚀 Updating relay-template on all live nodes"
echo "Repository: $TEMPLATE_REPO_URL"
echo "Repo path: $RELAY_REPO_PATH"
echo ""

# Get all relay daemon pods
PODS=$(kubectl get pods -l app=relay,app=relay-dfw2 -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || echo "")

if [ -z "$PODS" ]; then
  echo "❌ No relay pods found. Is the cluster reachable?"
  exit 1
fi

echo "📦 Found relay pods: $PODS"
echo ""

for POD in $PODS; do
  NAMESPACE=$(kubectl get pod "$POD" -o jsonpath='{.metadata.namespace}' 2>/dev/null || echo "default")
  echo "🔄 Updating $POD (namespace: $NAMESPACE)..."
  
  # Check if repo exists
  REPO_EXISTS=$(kubectl exec -n "$NAMESPACE" "$POD" -- test -d "$RELAY_REPO_PATH" && echo "yes" || echo "no")
  
  if [ "$REPO_EXISTS" = "yes" ]; then
    # Repo exists, fetch updates
    echo "  ✓ Repo exists at $RELAY_REPO_PATH"
    echo "  📥 Fetching from $TEMPLATE_REPO_URL..."
    
    kubectl exec -n "$NAMESPACE" "$POD" -- \
      git -C "$RELAY_REPO_PATH" fetch --all --prune || {
      echo "  ⚠️  Fetch failed, attempting full reclone..."
      
      # Backup old repo
      kubectl exec -n "$NAMESPACE" "$POD" -- \
        mv "$RELAY_REPO_PATH" "$RELAY_REPO_PATH.bak.$(date +%s)" || true
      
      # Clone fresh
      kubectl exec -n "$NAMESPACE" "$POD" -- \
        git clone --bare "$TEMPLATE_REPO_URL" "$RELAY_REPO_PATH"
    }
    
    echo "  ✓ Updated successfully"
  else
    # Repo doesn't exist, clone it
    echo "  ℹ️  Repo doesn't exist, cloning from $TEMPLATE_REPO_URL..."
    kubectl exec -n "$NAMESPACE" "$POD" -- \
      git clone --bare "$TEMPLATE_REPO_URL" "$RELAY_REPO_PATH"
    echo "  ✓ Cloned successfully"
  fi
  
  echo ""
done

echo "✅ All relay nodes updated!"
echo ""
echo "Note: Changes will be served by the relay-server on the next request."
