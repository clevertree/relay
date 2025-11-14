# Deployment guide: Rackspace spot instance + Kubernetes builders

Last updated: 2025-11-14

This document describes a recommended, testable deployment for building Relay CLI and desktop installers on a Rackspace spot (preemptible) instance, publishing artifacts to GitHub Container Registry (GHCR) and GitHub Releases, and serving downloads from `node1.relaynet.online`.

Goals
- Provision a spot instance via Terraform API and place it as `node1.relaynet.online`.
- Use existing kubeconfig to apply Kubernetes manifests to the cluster running on the instance.
- Run build runners in Kubernetes to build: multi-arch `relay` CLI (native static binaries), Tauri desktop bundles (macOS on macBuilder or cross-compile), and package installers for Windows/macOS/Linux.
- Push CLI Docker image(s) to GHCR so users can run `docker run ghcr.io/<org>/relay:latest` to use the CLI on any OS.
- Publish installers to GitHub Releases and expose stable download links on `node1.relaynet.online`.
- Implement resilience for spot eviction: artifact persistence to external object storage, ephemeral runner replacement, and automated retries.

Contract (inputs / outputs / success)
- Inputs:
  - Terraform credentials for Rackspace API
  - kubeconfig that targets the new cluster or instance
  - GitHub token with permissions to push to GHCR and create releases
  - Registry: ghcr.io/<org>
  - Domain DNS control for `relaynet.online`
- Outputs:
  - Running build cluster with runners
  - Published GHCR images and GitHub Release assets
  - Download endpoints on `node1.relaynet.online`
- Success criteria:
  - Able to build and publish a multi-arch `relay` CLI Docker image to GHCR
  - Able to download platform installers from `https://node1.relaynet.online/downloads/relay-<version>-<os>.{exe,dmg,tar.gz}`
  - Containerized CLI can be pulled and run on macOS, Linux, Windows (via Docker Desktop)

High-level steps
1. Reserve DNS and TLS for `node1.relaynet.online` (A record to instance IP; TLS via cert-manager with Let's Encrypt)
2. Provision Rackspace spot instance via Terraform.
3. Bootstrap Kubernetes (k3s/minikube/kubeadm — prefer k3s for simplicity on a single instance).
4. Apply Ingress controller (nginx or Traefik) and cert-manager.
5. Install object storage gateway or configure remote object store (Rackspace Swift or S3-compatible).
6. Deploy builder fleet (BuildKit / Kaniko) as Kubernetes Jobs or a CI runner (self-hosted GitHub Actions runner). Mount a PVC for caching; persist artifacts to remote object storage.
7. Configure GitHub Actions workflows to use the cluster runner or remote builder, build artifacts, sign checksums, and publish to GHCR and GitHub Releases.
8. Create and publish download pages and stable endpoints on `node1.relaynet.online`.

Detailed plan and examples

1) DNS & TLS (node1.relaynet.online)
- Create an A record for `node1.relaynet.online` pointing to the public IP assigned by Rackspace to the instance. If you use Cloudflare for DNS, create the record there and decide whether to enable Cloudflare proxying (the "orange cloud"). Proxying gives you CDN/WAF but can interfere with HTTP-01 ACME challenges; for HTTP-01 validation you may need to temporarily disable proxying (set DNS to DNS-only / grey cloud), or use DNS-01 challenges instead.

- TLS options with Cloudflare:
  - Cloudflare-managed TLS (Cloudflare fronting): Cloudflare will terminate TLS at the edge and present certificates to clients. You can use a Cloudflare Origin Certificate on your origin for the connection between Cloudflare and your instance.
  - cert-manager with DNS-01 via Cloudflare: Preferred for fully-automated Let's Encrypt cert issuance while keeping Cloudflare proxy enabled. Configure cert-manager's Cloudflare DNS01 solver using an API token with minimal DNS:Edit privileges.

- Recommended approach: Use cert-manager + DNS-01 (Cloudflare) so Let's Encrypt certs are issued without toggling proxy settings. Steps:
  1. Create a Cloudflare API token scoped to the DNS zone (least privilege: Zone.Zone, Zone.DNS:Edit for the zone or minimal granular permissions). Save it as `CLOUDFLARE_API_TOKEN` in GitHub and as a Kubernetes secret for cert-manager.
  2. Install cert-manager in the cluster.
  3. Create a `Secret` named `cloudflare-api-token` in the `cert-manager` namespace containing the API token.
  4. Create a `ClusterIssuer` that uses the cloudflare DNS01 solver. Example (see cert-manager docs):

     apiVersion: cert-manager.io/v1
     kind: ClusterIssuer
     metadata:
       name: letsencrypt-dns-cloudflare
     spec:
       acme:
         server: https://acme-v02.api.letsencrypt.org/directory
         email: ops@example.com
         privateKeySecretRef:
           name: letsencrypt-dns-cloudflare
         solvers:
         - dns01:
             cloudflare:
               email: ops@example.com
               apiTokenSecretRef:
                 name: cloudflare-api-token
                 key: api-token

- In Kubernetes, install an Ingress controller (NGINX or Traefik) and create an Ingress for the downloads host that references the TLS cert produced by the `ClusterIssuer` or uses Cloudflare-origin certs.


Notes and best practices
- Use Let's Encrypt staging while testing to avoid rate limits.
- Enable HTTP->HTTPS redirect at Ingress level.

2) Terraform (provision spot instance)
- The user already has a Terraform API setup. Ensure the Terraform config includes:
  - A floating IP / reserved public IP assigned to the instance
  - Security group allowing inbound 22, 80, 443, 9418 (git daemon), 8080 (host HTTP server), and the ports you need for builder access
  - A metadata or cloud-init script to bootstrap k3s + docker

Sample (pseudo) cloud-init steps for the instance:
- install dependencies (docker, k3s)
- configure swap and mount for /var/lib/docker (if using local SSD)
- install ingress/nginx or configure kubeadm join (if control plane external)
- create a kubeconfig user for CI to use (or rely on external kubeconfig)

3) Kubernetes bootstrap
- For a single-node test master, k3s is recommended: lightweight, easy to install, supports ARM/AMD.
- Helm: install `cert-manager`, `ingress-nginx` or `traefik`, and optionally `minio` for S3-compatible object storage if Rackspace Swift is not used.

4) Artifact persistence
- Because spot instances can be preempted, store built artifacts in remote object storage immediately after build (S3-compatible or Swift). Use short-lived local cache only.
- If you prefer local caching, use PVC(s) backed by larger persistent volumes.
- For signed artifacts, sign with a private key stored in Kubernetes secrets or an external KMS (recommended).

5) Builders
Options:
- BuildKit (preferred): run BuildKit in Kubernetes as a Deployment; expose it via a ClusterIP and connect GitHub Actions to it using a port-forward or a self-hosted runner that runs the build steps.
- Kaniko: good for building container images inside Kubernetes without privileged Docker daemon.
- Self-hosted GitHub Actions runners: install runners in Kubernetes (as pods); allow Actions workflows to dispatch jobs to them. This avoids having to expose buildkit directly.

Recommended approach for CI simplicity:
- Use GitHub Actions with self-hosted runners deployed in the k8s cluster. Runners perform the builds and push artifacts.
- Runners should write artifacts to remote object store and to GHCR/GitHub Releases.

6) CI/CD workflows (GitHub Actions)
- Secrets needed in repo settings: GITHUB_TOKEN (default), GHCR_PAT (personal access token with write:packages), S3/Swift credentials, KUBECONFIG (if Actions need to kubectl apply), SIGNING_KEY (for artifact signatures)

Suggested workflows:
- build-cli.yml (matrix: linux/amd64 linux/arm64 windows/amd64 macos/amd64 if available)
  - Use `cross` or `cross-compile` in Rust for multi-arch, or use GitHub-hosted macOS runners for mac builds if Tauri needs macOS.
  - Build static CLI binaries for each arch
  - Build Docker images (multi-arch) using `docker buildx` and push to GHCR
  - Upload the binary artifacts to GitHub Releases; also copy to S3/Swift under `releases/<version>/` for CDN
  - Generate checksums and GPG signatures

- build-desktop.yml
  - Windows: use GitHub Windows runners to create installers (MSI/NSIS)
  - macOS: use GitHub macOS runners or a mac-builder to create DMG/PKG
  - Linux: create AppImage / tar.gz
  - Upload installers to GitHub Releases and S3

- publish.yml
  - After artifacts are available, update `latest` tags and rewrite static download pages under `/downloads/` on `node1.relaynet.online`

7) Serving downloads on node1.relaynet.online
- Option A (recommended): Keep downloads on GitHub Releases / GHCR and use the node as a reverse-proxy/cache. Use Ingress with `proxy_cache` enabled in nginx to cache release assets.
- Option B: Host files in an object store (S3/Swift) and configure a CDN or Cloudflare in front; use `node1.relaynet.online` to proxy or redirect to the CDN.

Recommended URLs
- Docker CLI image: ghcr.io/<org>/relay:latest
- CLI direct download: https://node1.relaynet.online/downloads/relay-<version>-<os>.tar.gz
- Desktop installers: https://node1.relaynet.online/downloads/relay-<version>-mac.dmg

8) Dockerized CLI usage
- Publish a small Docker image that includes the `relay` binary and exposes it via entrypoint. Users can run:

  docker run --rm -it ghcr.io/<org>/relay:latest relay --help

- To mount local files into the container for filesystem operations (e.g., `relay repo validate`):

  docker run --rm -it -v $PWD:/work -w /work ghcr.io/<org>/relay:latest relay repo validate --path /work/host/repos/movies

Best practices
- Use multi-arch buildx with QEMU emulation to provide linux/arm64 and linux/amd64 images from CI
- Prefer GHCR for container images and GitHub Releases for installers (well supported and stable links)
- Expose a stable reverse-proxied path for downloads on `node1.relaynet.online` to simplify user-facing links
- Sign installers (GPG or code signing where applicable) and provide checksums
- Store signing keys in an external KMS or in GitHub Secrets; use ephemeral signing tokens if possible
- Keep build artifacts in remote object storage to survive spot evictions and to provide a CDN origin
- Use Infrastructure-as-Code for everything (Terraform + Helmfile/Helm charts)
- Use healthchecks and pod disruption budgets where appropriate; ensure critical services have restart policies
- For spot instances: use a provisioner that re-creates the cluster node (or use an autoscaling group with multiple spot nodes) and rely on remote artifact storage so builds can resume elsewhere

Operational notes for node1.relaynet.online
- Start with a single small instance to validate the workflow.
- Keep an ssh key to the machine; use Terraform to reprovision or snapshot after a working baseline.
- Monitor disk and network; rotate logs and move artifacts to remote storage.

Security recommendations
- Limit inbound firewall rules; open only necessary ports (SSH to a specific IP, HTTPS, HTTP for testing, git port if exposing git daemon).
- Use cert-manager with Let's Encrypt for TLS; configure HSTS headers and redirect HTTP->HTTPS.
- Require tokens for publishing to GHCR and Releases (store them in GitHub Secrets)
- Sign releases and artifacts
- Limit SSH access (disable password auth; use key pairs)

Example manifests (Ingress + simple downloads service)
- A minimal nginx ingress with a Kubernetes Deployment serving `/usr/share/nginx/html/downloads` can host static assets. Use a `ConfigMap` for nginx config to enable caching and TLS redirect.

Next steps — checklist for hands-on setup
- [ ] Create DNS A record for `node1.relaynet.online` pointing to the instance IP
- [ ] Set up Terraform to create the spot instance and attach a floating IP
- [ ] Create cloud-init to bootstrap k3s and install Helm
- [ ] Install Helm charts: cert-manager, ingress-nginx, minio (optional)
- [ ] Deploy self-hosted GitHub Actions runner or builder pods
- [ ] Create GitHub Actions workflows (build + publish) and set repository secrets
- [ ] Run a full build pipeline and verify artifacts in GHCR and GitHub Releases
- [ ] Create download redirects and verify `https://node1.relaynet.online/downloads/...` links

## Rancher integration (you already have Rancher)

If Rancher is already installed and running, use it as the primary UI and control plane to manage the spot instance, node pools, and workloads. The steps below assume Rancher has access to the cluster or to the node pool that will host `node1.relaynet.online`.

- Import or provision the target cluster in Rancher (Import if cluster already exists, or use Rancher to provision nodes if you want Rancher to manage lifecycle).
- Use node templates / node pools to mark the spot instance(s) with a label such as `role=builder` and a taint like `spot=true:NoSchedule` so only explicitly tolerant workloads land there.
- Create a separate namespace/project in Rancher for build infrastructure (e.g., `build` or `ci`). Use Rancher Projects to group workloads and RBAC.
- Install Helm charts through Rancher Apps (or use `helm` CLI from a GitOps pipeline). Charts to install: `cert-manager`, `ingress-nginx` or `traefik`, `minio` (optional), `actions-runner-controller` (see below), and `buildkit`/`kaniko` as needed.

Self-hosted GitHub Actions runners
- Deploy `actions-runner-controller` (https://github.com/actions-runner-controller/actions-runner-controller) via Helm in the `build` namespace. Create a `RunnerDeployment` that uses nodeSelector/affinity to target `role=builder` nodes and add tolerations for the `spot` taint. This lets you autoscale the runner pods and schedule them preferentially on spot nodes.

Example affinity/toleration snippet for runner pods:

```yaml
affinity:
  nodeAffinity:
    requiredDuringSchedulingIgnoredDuringExecution:
      nodeSelectorTerms:
      - matchExpressions:
        - key: role
          operator: In
          values:
          - builder
tolerations:
  - key: "spot"
    operator: "Equal"
    value: "true"
    effect: "NoSchedule"
```

Builders (BuildKit / Kaniko)
- For container image builds prefer Kaniko (daemonless) or BuildKit. You can run BuildKit as a Deployment and expose it internally, or use Kaniko via Jobs for image builds.
- If you run BuildKit, create a small service that only runners can access (via NetworkPolicy) and use nodeSelector to keep heavy build pods on builder nodes.

Artifact persistence and eviction handling
- Ensure runners upload artifacts to remote object storage (S3/Swift/MinIO) immediately after build. Use lifecycle hooks or sidecar containers if necessary to guarantee upload on preemption signals.
- Configure Rancher alerts or node templates to automatically reprovision replacement nodes when a spot node is evicted. Use a small pool of spot nodes if you need higher availability.

Using the Rancher UI for quick tasks
- Use Rancher -> Cluster -> Apps & Marketplace to install charts quickly (cert-manager, ingress-nginx, minio).
- Use Rancher -> Cluster -> Workloads to create CronJobs or Jobs for scheduled builds (e.g., nightly artifact refresh), and to inspect runner logs and pod events.

GitOps and Fleet (optional)
- If you manage multiple clusters or want declarative rollout, use Rancher Fleet or a GitOps operator to keep Helm charts and `RunnerDeployment` CRs in sync with a repo.

Notes and tips
- Keep the signing keys in a secure secret (Kubernetes `Secret` or external KMS) and only mount them into runner pods when required. Prefer ephemeral keys or signing service if possible.
- Use PodDisruptionBudgets (PDBs) for critical services but not for spot-only runners.
- Test the full eviction path: preempt one builder node, verify runners are recreated and that in-progress jobs either resume or artifacts are available in object storage.


Appendix — sample GitHub Actions snippet (publish docker image using buildx)

```yaml
# .github/workflows/build-and-push-image.yml (snippet)
name: Build and push multi-arch image
on:
  push:
    tags: ["v*", "main"]

jobs:
  build:
    runs-on: self-hosted
    steps:
      - uses: actions/checkout@v4
      - name: Set up QEMU
        uses: docker/setup-qemu-action@v2
      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v2
      - name: Login to GHCR
        uses: docker/login-action@v2
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GHCR_PAT }}
      - name: Build and push
        run: |
          docker buildx build --platform linux/amd64,linux/arm64 \
            --push -t ghcr.io/${{ github.repository_owner }}/relay:latest .
```

Troubleshooting
- If a spot instance is preempted while a build is running, check the CI logs and re-run the job; the artifact should be pushed to object storage if the workflow completed the upload step before eviction.
- If TLS issuance fails, switch to Let's Encrypt staging to debug ACME challenges.


Change log
- 2025-11-14: Initial deployment guide added.

## CI / Repo secrets and Cloudflare notes

For the workflows added to this repository, set the following GitHub repository secrets (names recommended):

- GHCR_PAT — personal access token with write:packages and read:packages to push images to GHCR.
- S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY — if using S3-compatible object storage (or equivalent Rackspace Swift credentials).
- KUBECONFIG — base64-encoded kubeconfig if Actions need to run kubectl against your cluster (optional).
- SIGNING_KEY — PGP private key or reference to your signing KMS for artifact signatures.
- CLOUDFLARE_API_TOKEN — Cloudflare API token with DNS edit privileges for `relaynet.online` (if using cert-manager DNS01 or Cloudflare API-driven invalidation).
- CLOUDFLARE_ZONE_ID — the Cloudflare zone id for `relaynet.online` (some Actions need it).

Notes:
- Keep the `CLOUDFLARE_API_TOKEN` scoped to the minimal required permissions (DNS:Edit for the target zone). Do not use a global Cloudflare API key.
- GHCR_PAT should be a machine account or personal account token with limited scope and should be rotated periodically.
- If you prefer to avoid storing KUBECONFIG in GitHub Secrets, run the build runners inside the cluster (self-hosted runners) that already have access to the cluster API.

