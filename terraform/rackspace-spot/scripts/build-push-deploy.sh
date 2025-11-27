#!/bin/sh
# Build, tag, push relay image and update DaemonSet.
# Usage: REGISTRY=ghcr.io/yourorg RELAY_IMAGE_TAG=latest ./build-push-deploy.sh
set -e
REGISTRY="${REGISTRY:-}" # e.g. ghcr.io/clevertree
TAG="${RELAY_IMAGE_TAG:-latest}"
if [ -z "$REGISTRY" ]; then
  echo "Set REGISTRY (e.g. ghcr.io/yourorg)"
  exit 2
fi
IMAGE="$REGISTRY/relay:$TAG"

echo "Building image $IMAGE"
docker build -t $IMAGE ..

echo "Pushing image $IMAGE"
docker push $IMAGE

# Update the DaemonSet manifest and patch the running DaemonSet
SED_ESC_IMAGE=$(printf '%s' "$IMAGE" | sed 's/[\/&]/\\&/g')
# Update in-file manifest
sed -i.bak "s|image: .*relay:latest|image: $SED_ESC_IMAGE|" ../k8s/relay-daemonset.yaml

echo "Applying updated DaemonSet manifest"
kubectl --kubeconfig=/tmp/kubeconfig apply -f ../k8s/relay-daemonset.yaml

echo "Triggering DaemonSet rollout"
kubectl --kubeconfig=/tmp/kubeconfig rollout restart daemonset/relay-daemon

echo "Done"
