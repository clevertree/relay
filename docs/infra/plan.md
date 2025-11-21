# Relay Infrastructure Plan

This document outlines the end-to-end plan to:

1. Build and publish the server Docker image to GitHub Container Registry (GHCR).
2. Set up and monitor a GitHub Actions workflow for CI/CD to GHCR.
3. Create a Terraform plan to provision a Rackspace Spot Cloudspace and a minimal nodepool for testing.
4. Validate the remote deployment (HTTP and Git socket access).
5. Track next steps to manage application deployment with kubecfg (pending kubeconfig).

---

## 1) Docker image publishing to GHCR

- Registry: GHCR `ghcr.io`. Image name will follow the pattern `ghcr.io/<owner>/<repo>:<tag>`.
- Source Dockerfile: `Dockerfile` at the repository root. It builds the Rust server binary and packages runtime dependencies (git, deluge, IPFS/kubo, tini). Ports exposed by the image: 8088 (HTTP), 9418 (git), plus IPFS and Deluge ports.
- Authentication: Use `GHCR_PAT` within GitHub Actions to push to GHCR. The workflow will set appropriate permissions.
- Tagging strategy:
  - For branch builds on `main`: `ghcr.io/<owner>/<repo>:main` and `ghcr.io/<owner>/<repo>:sha-<shortsha>`.
  - For tags: semantic tag `ghcr.io/<owner>/<repo>:<tag>` and `:latest` (on release tags only).

## 2) CI/CD via GitHub Actions (GHCR publish)

Create a workflow `.github/workflows/docker-publish.yml` that:

- Triggers on:
  - Push to `main` and
  - Any Git tag.
- Sets `packages: write` permission to allow pushing to GHCR.
- Logs in to GHCR using `${{ github.actor }}` and `${{ secrets.GHCR_PAT }}`.
- Uses `docker/metadata-action` to compute tags and labels.
- Builds multi-arch where feasible (linux/amd64 by default; arm64 optional) using Buildx.
- Pushes the image to GHCR.

Monitoring with GitHub CLI (gh):

```
# View workflow runs
gh run list -w docker-publish

# Stream logs for the latest run of the workflow
gh run watch -w docker-publish --exit-status

# Or view logs for a specific run
gh run view <run-id> --job build-and-push --log
```

Once a run succeeds, verify the image exists:

```
# List packages in this repository owner scope
gh api -H "Accept: application/vnd.github+json" \
  /users/${GITHUB_USER:-$(gh api user --jq .login)}/packages?package_type=container

# Pull the image locally (example for main tag)
docker pull ghcr.io/<owner>/<repo>:main

# Test run locally
docker run --rm -p 8088:8088 -p 9418:9418 ghcr.io/<owner>/<repo>:main
```

## 3) Terraform plan for Rackspace Spot (single small test server)

Objectives:

- Provision a Cloudspace in region `us-central-dfw-1`.
- Create a minimal Spot node pool using the smallest available class `gp.vs1.small-dfw`.
- Create 1 server (desired_server_count = 1). No autoscaling initially.
- Obtain kubeconfig via the `spot_kubeconfig` data source for future use with kubecfg.
- Keep secrets out of VCS; read the token from repo root file `rackspace_token` by default, while allowing overrides via `terraform.tfvars`.

Files to be created under `terraform/rackspace-spot/`:

- `versions.tf`: pins Terraform and provider.
- `variables.tf`: variables for cloudspace name, region, server class, bid price, and optional token override.
- `main.tf`: configures the provider, resources for cloudspace and node pool, and reads kubeconfig.
- `outputs.tf`: outputs kubeconfig (sensitive), cloudspace name, and useful info.
- `terraform.tfvars.example`: example variable values. Copy to `terraform.tfvars` to override defaults.
- `.gitignore`: ignore `.terraform/`, `terraform.tfstate*`, and `terraform.tfvars`.

Token source:

- Default: read from `rackspace_token` at the repository root using `file()` and `chomp()`.
- Override: set `rackspace_spot_token` in `terraform.tfvars` if needed (e.g., CI environments).

Usage:

```
cd terraform/rackspace-spot
cp terraform.tfvars.example terraform.tfvars   # optional override
terraform init
terraform plan
terraform apply
```

Note: The Rackspace Spot provider will create the Kubernetes control plane and the worker(s) in the chosen region. Creation can take several minutes.

## 4) Validation on the remote server

After the cloudspace is ready and once the application is deployed:

- Validate HTTP:
  - If you expose a Service with a LoadBalancer or Ingress, confirm you can `curl http://<external-ip>:8088/health` (adjust path if different).
  - Alternatively, `kubectl port-forward` to a Pod/Service and test `localhost:8088`.
- Validate Git socket:
  - Ensure the Pod exposes port 9418 and the Service maps it.
  - Test locally: `git ls-remote git://<external-ip>:9418/your/repo.git` (or via port-forward on 9418).

For bare-metal-style VM validation (if you run the container directly on a server):

```
docker run --rm -p 8088:8088 -p 9418:9418 ghcr.io/<owner>/<repo>:<tag>
curl -I http://localhost:8088/
git ls-remote git://localhost:9418/repo.git || true
```

## 5) Application deployment with kubecfg (pending kubeconfig)

- We will use `kubecfg` to apply and manage Kubernetes manifests once the kubeconfig is available.
- Action items once kubeconfig is provided:
  1. Add kubecfg manifests/templates for the Relay server Deployment, Service, and any ConfigMaps/Secrets required.
  2. Wire image reference to `ghcr.io/<owner>/<repo>:<tag>` via values or environment.
  3. CI integration to deploy on successful image publish (optional, post‑MVP).

---

Risks and Notes:

- Provider naming and schema follow `rackerlabs/spot`; ensure Terraform version compatibility.
- `rackspace_token` must be kept secret; it is already listed in `.gitignore` at repo root.
- Start with a minimal node count to control costs; scale out only after validation.
