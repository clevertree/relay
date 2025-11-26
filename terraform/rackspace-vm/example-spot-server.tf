// Example: adjust names/types to match your provider's server resource
// Use this as a starting point; the provider resource names may differ

locals {
  cloudspace_name = var.cloudspace_name
}

resource "spot_cloudspace" "cs" {
  cloudspace_name = local.cloudspace_name
  region          = var.region
}

resource "spot_server" "relay_vm" {
  cloudspace_name = spot_cloudspace.cs.cloudspace_name
  name            = "relay-vm-1"
  server_class    = var.server_class
  image           = var.image_id
  ssh_keys        = [var.ssh_public_key]
  user_data       = templatefile("${path.module}/cloud-init.tpl", {
    GHCR_USERNAME       = var.ghcr_username
    GHCR_PAT            = var.ghcr_pat
    RELAY_DNS_SUBDOMAIN = var.relay_dns_subdomain
    CERTBOT_EMAIL       = var.certbot_email
  })
}
