variable "cloudspace_name" {
  description = "Name of the Rackspace Spot Cloudspace"
  type        = string
  default     = "relay-test"
}

variable "region" {
  description = "Rackspace Spot region identifier"
  type        = string
  default     = "us-central-dfw-1"
}

variable "server_class" {
  description = "Server class for the spot nodepool"
  type        = string
  default     = "gp.vs1.small-dfw"
}

variable "bid_price" {
  description = "Bid price for spot instances (USD per hour). Adjust as needed."
  type        = number
  default     = 0.002
}

variable "rackspace_spot_token" {
  description = "Rackspace Spot API token (optional; if not provided, will be read from ../../rackspace_token)"
  type        = string
  sensitive   = true
  default     = null
}

# Vercel API token for DNS automation (used by Docker entrypoint inside the VM)
variable "vercel_api_token" {
  description = "Vercel API token for managing DNS records"
  type        = string
  sensitive   = true
  default     = null
}
