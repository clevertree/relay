variable "cloudspace_name" {
  type    = string
  default = "relay-vm"
}

variable "region" {
  type    = string
  default = "us-central-dfw-1"
}

variable "server_class" {
  type    = string
  default = "gp.vs1.small-dfw"
}

variable "image_id" {
  type    = string
  default = "ubuntu-22.04"
}

variable "ssh_public_key" {
  type = string
}

variable "ghcr_username" {
  type    = string
  default = "ghcr_username_placeholder"
}

variable "ghcr_pat" {
  type      = string
  sensitive = true
}

variable "relay_dns_subdomain" {
  type    = string
  default = ""
}

variable "certbot_email" {
  type    = string
  default = ""
}
