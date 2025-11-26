Relay DaemonSet
----------------

This manifest deploys the `ghcr.io/clevertree/relay:latest` image as a DaemonSet on the spot nodepool created by the `terraform/rackspace-spot` configuration.

How to apply
1. Run `terraform apply` in `terraform/rackspace-spot` using your `RACKSPACE_TERRAFORM_TOKEN` (the module outputs a kubeconfig via the `spot_kubeconfig` data source).
2. Save the kubeconfig output locally (the terraform output `kubeconfig` is sensitive; write it to `~/.kube/relay-kubeconfig`):

```bash
terraform output -raw kubeconfig > ~/.kube/relay-kubeconfig
export KUBECONFIG=~/.kube/relay-kubeconfig
kubectl apply -f k8s/relay-daemonset.yaml
```

3. The DaemonSet will schedule a pod on each node and the pods use `hostNetwork: true` so they bind directly to node ports 80 and 443 (smoke-test only).

Notes:
- This is intended for quick smoke tests only. Using hostNetwork is a shortcut; a proper Service / Ingress is recommended for production.
- If the nodepool uses taints, add tolerations or nodeSelector labels as needed.
