#!/bin/bash
# Direct update using kubectl exec
# These commands will pull the latest relay-template on each live node
# 
# Usage:
#   ./scripts/kubectl-exec-update-template.sh
# 
# Or run individual commands directly in your terminal

set -e

TEMPLATE_REPO_URL="https://github.com/clevertree/relay-template"
RELAY_REPO_PATH="/srv/relay/data/repo.git"

echo "📋 Generating kubectl commands to update relay-template on live nodes..."
echo ""

# DFW1 Node
echo "=== DFW1 Node (relay-daemon) ==="
echo ""
echo "# Fetch latest from relay-template"
echo "kubectl exec -n default -it deployment/relay-daemon -- sh -c '\\"
echo "  git -C $RELAY_REPO_PATH fetch --all --prune && \\"
echo "  echo \"✓ DFW1 updated\"\\"
echo "'"
echo ""

# DFW2 Node  
echo "=== DFW2 Node (relay-daemon-dfw2) ==="
echo ""
echo "# Fetch latest from relay-template"
echo "kubectl exec -n default -it deployment/relay-daemon-dfw2 -- sh -c '\\"
echo "  git -C $RELAY_REPO_PATH fetch --all --prune && \\"
echo "  echo \"✓ DFW2 updated\"\\"
echo "'"
echo ""

echo "---"
echo ""
echo "Or use the update-relay-template.sh script once cluster is accessible:"
echo "  ./scripts/update-relay-template.sh"
