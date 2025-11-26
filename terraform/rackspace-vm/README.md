# Rackspace VM (simple Docker) Terraform scaffold

Purpose
-------
This folder contains a minimal scaffold to run a single VM on Rackspace (Spot) and start the relay Docker container via cloud-init. It's intended as a quick, simple runtime for smoke-testing the container image (pull `ghcr.io/clevertree/relay:latest`).

Important assumptions
---------------------
- The `rackerlabs/spot` provider is present and configured (this repository already contains `terraform/rackspace-spot`).
- This scaffold provides an example `cloud-init.tpl` and a small Terraform snippet (`example-spot-server.tf`) demonstrating how to pass the rendered cloud-init to a server resource. Resource names and attributes may need adjustment to match your installed provider version.
- For security, you should provide `GHCR_PAT` (if the image is private) via cloud-init/user-data in a secure way, or make the image public and avoid embedding credentials.

Quick steps
-----------
1. Copy `cloud-init.tpl` to a location referenced by your Terraform module or use the example file.
2. Update `example-spot-server.tf` to match your provider version and naming (resource names may differ depending on provider).
3. Supply `rackspace_spot_token` via environment, `terraform.tfvars`, or the repository root `rackspace_token` file. You already added `RACKSPACE_TERRAFORM_TOKEN` to `.env.local` for local runs.
4. Run `terraform init` and `terraform apply` in this folder (or call the example from a root terraform that configures the provider).

If you'd like, I can adapt this into a drop-in module that targets the provider resources present in `terraform/rackspace-spot` so it applies cleanly without manual edits.
