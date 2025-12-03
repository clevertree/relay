#!/bin/bash
# Deploy Relay to Rackspace Kubernetes cluster
# 
# Usage: ./deploy-to-rackspace.sh [namespace] [timeout]
# 
# Example:
#   ./deploy-to-rackspace.sh
#   ./deploy-to-rackspace.sh relay 600

set -e

NAMESPACE="${1:-default}"
WAIT_TIMEOUT="${2:-300}"

echo "🚀 Deploying Relay to Rackspace"

# Verify kubectl connection
echo "📋 Checking cluster connection..."
CONTEXT=$(kubectl config current-context) || {
    echo "✗ Failed to connect to cluster"
    exit 1
}
echo "✓ Connected to: $CONTEXT"

# Get k8s manifests directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
K8S_DIR="$SCRIPT_DIR/terraform/rackspace-spot/k8s"

if [[ ! -d "$K8S_DIR" ]]; then
    echo "✗ K8s manifests directory not found: $K8S_DIR"
    exit 1
fi

echo "📂 K8s manifests: $K8S_DIR"

# Apply daemonsets
echo ""
echo "📦 Applying relay-daemonset.yaml..."
kubectl apply -f "$K8S_DIR/relay-daemonset.yaml"

echo "📦 Applying relay-daemonset-dfw2.yaml..."
kubectl apply -f "$K8S_DIR/relay-daemonset-dfw2.yaml"

# Restart rollout
echo ""
echo "🔄 Restarting relay-daemon..."
kubectl rollout restart daemonset/relay-daemon -n "$NAMESPACE"

echo "🔄 Restarting relay-daemon-dfw2..."
kubectl rollout restart daemonset/relay-daemon-dfw2 -n "$NAMESPACE"

# Wait for rollout
echo ""
echo "⏳ Waiting for rollout (timeout: ${WAIT_TIMEOUT}s)..."
echo "  - relay-daemon"
kubectl rollout status daemonset/relay-daemon -n "$NAMESPACE" --timeout="${WAIT_TIMEOUT}s" || {
    echo "✗ relay-daemon rollout failed"
    exit 1
}

echo "  - relay-daemon-dfw2"
kubectl rollout status daemonset/relay-daemon-dfw2 -n "$NAMESPACE" --timeout="${WAIT_TIMEOUT}s" || {
    echo "✗ relay-daemon-dfw2 rollout failed"
    exit 1
}

# Verify deployment
echo ""
echo "✅ Deployment successful!"

echo ""
echo "📊 Pod Status:"
kubectl get pods -n "$NAMESPACE" -l app=relay
kubectl get pods -n "$NAMESPACE" -l app=relay-dfw2

echo ""
echo "🔍 Image Verification:"
echo "relay-daemon:"
kubectl describe pod -n "$NAMESPACE" -l app=relay | grep "Image:" | head -1

echo "relay-daemon-dfw2:"
kubectl describe pod -n "$NAMESPACE" -l app=relay-dfw2 | grep "Image:" | head -1

echo ""
echo "✨ Relay is now running the latest version!"
