terraform {
  required_version = ">= 1.10" # use_lockfile in the S3 backend needs 1.10+

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.21"
    }
  }
}
