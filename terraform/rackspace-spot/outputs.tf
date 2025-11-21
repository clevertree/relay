output "cloudspace_name" {
  description = "Cloudspace name"
  value       = spot_cloudspace.cs.cloudspace_name
}

output "region" {
  description = "Region where the cloudspace is created"
  value       = spot_cloudspace.cs.region
}

output "server_class" {
  description = "Server class used by the nodepool"
  value       = spot_spotnodepool.pool.server_class
}

output "kubeconfig" {
  description = "Raw kubeconfig for the created cloudspace"
  value       = data.spot_kubeconfig.this.raw
  sensitive   = true
}
