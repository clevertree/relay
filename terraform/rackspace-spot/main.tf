locals {
  token_file_path = "${path.module}/../../rackspace_token"
  token_file      = can(file(local.token_file_path)) ? chomp(file(local.token_file_path)) : null
  spot_token      = var.rackspace_spot_token != null && var.rackspace_spot_token != "" ? var.rackspace_spot_token : local.token_file
}

provider "spot" {
  token = local.spot_token
}

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
