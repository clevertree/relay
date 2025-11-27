locals {
  token_file_path = "${path.module}/../../rackspace_token"
  token_file      = can(file(local.token_file_path)) ? chomp(file(local.token_file_path)) : null
  spot_token      = var.rackspace_spot_token != null && var.rackspace_spot_token != "" ? var.rackspace_spot_token : local.token_file
}

provider "spot" {
  token = local.spot_token
}

provider "kubernetes" {
  # Use a module-local kubeconfig path for cross-platform compatibility
  config_path = abspath("${path.module}/kubeconfig")
}

// Data source to list available server classes and their metadata (used for debugging)
data "spot_serverclasses" "all" {}

resource "spot_cloudspace" "cs" {
  cloudspace_name   = var.cloudspace_name
  region            = var.region
  hacontrol_plane   = false
  wait_until_ready  = true
  kubernetes_version = "1.31.1"
  cni               = "calico"
}

resource "spot_spotnodepool" "pool" {
  cloudspace_name      = spot_cloudspace.cs.cloudspace_name
  server_class         = var.server_class
  bid_price            = var.bid_price
  desired_server_count = 1

  labels = {
    "managed-by" = "terraform"
    "component"  = "relay-server"
  }
}

data "spot_kubeconfig" "this" {
  cloudspace_name = spot_cloudspace.cs.cloudspace_name
}

resource "local_file" "kubeconfig" {
  content  = data.spot_kubeconfig.this.raw
  filename = abspath("${path.module}/kubeconfig")
}
