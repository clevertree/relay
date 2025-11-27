# Create Kubernetes secret `relay-credentials` containing Vercel token/team id
# Requires the Kubernetes provider to be configured (kubeconfig from outputs)

resource "kubernetes_secret" "relay_credentials" {
  depends_on = [
    spot_cloudspace.cs,
    local_file.kubeconfig
  ]
  metadata {
    name      = "relay-credentials"
    namespace = "default"
  }

  data = {
    VERCEL_API_TOKEN = var.vercel_api_token != null ? var.vercel_api_token : ""
    VERCEL_TEAM_ID   = var.vercel_team_id != null ? var.vercel_team_id : ""
  }

  type = "Opaque"
}
