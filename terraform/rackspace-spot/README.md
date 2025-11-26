# Rackspace Spot Terraform for Relay

This folder contains Terraform configuration to provision a Rackspace Spot cloudspace and a nodepool intended to run the relay container image.

Secrets and configuration
- `rackspace_spot_token` / `RACKSPACE_TERRAFORM_TOKEN`: The Terraform/Rackspace Spot token. You can set this in several ways:
  - Provide it via `terraform.tfvars` (not recommended for secrets).
  - Create a file at the repository root `rackspace_token` (the module will read it if present).
  - Export it in your shell environment or use a `.env.local` file during local runs (you have already added `RACKSPACE_TERRAFORM_TOKEN` to `.env.local`).

Usage
1. Ensure Terraform >= 1.5.x is installed.
2. Set `rackspace_spot_token` via environment or `terraform.tfvars`.
3. Run `terraform init` then `terraform apply` in this folder.

Notes
- This configuration creates a cloudspace and a spot nodepool (Kubernetes) by default. If you prefer a single VM instance with a systemd unit that pulls the GHCR image, I can add that as an alternate, simpler module.
- The Terraform here uses the `rackerlabs/spot` provider. See `variables.tf` and `terraform.tfvars.example` for overridable defaults.
