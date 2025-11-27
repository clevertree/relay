Cert-manager integration notes

Overview

This project currently runs certbot inside the relay container and persists certificates to hostPath directories on the node. For a more Kubernetes-native solution with automatic renewals and better lifecycle management, we recommend installing cert-manager.

Quick steps (high level):

1. Install cert-manager (recommended):
   - kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.16.1/cert-manager.yaml
   - Wait for cert-manager CRDs and controller to be ready: kubectl -n cert-manager wait --for=condition=available deployment --all --timeout=120s

2. Create a ClusterIssuer using HTTP-01 (example provided):
   - kubectl apply -f k8s/cert-manager-clusterissuer.yaml

3. Create an Ingress that uses cert-manager (example):
   - Ensure an nginx Ingress controller is present and configured to handle HTTP challenges.
   - Annotate the Ingress with cert-manager.io/cluster-issuer: "letsencrypt-prod"

DNS-01 with Vercel

- If you want to use DNS-01 (recommended when you can't route HTTP traffic to a single Ingress), you'll need a DNS webhook or an external solver for Vercel. cert-manager does not ship a Vercel DNS provider by default.
- Options:
  - Use a DNS provider supported by cert-manager (Cloudflare, Route53, GCP, etc.)
  - Implement a custom cert-manager DNS webhook for Vercel or use an external service that can update Vercel DNS.

Migration notes

- After cert-manager is running and issuing certificates, you can stop using in-container certbot. Ensure /etc/letsencrypt is migrated (if you want continuity) or allow cert-manager to provision fresh certs.
- For multi-node clusters, switch from hostPath to PersistentVolumeClaims or let cert-manager manage certificates via Secrets mounted into Ingress resources.
