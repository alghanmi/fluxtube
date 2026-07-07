# ── Cloudflare Pages project (dashboard PWA) ────────────────────────────────
#
# Naming shape matches the resource-name prefix pattern:
#
#   instance_id = "alghanmi" → project name = "fluxtube-alghanmi-dashboard"
#
# The Pages project serves the static Astro build from
# `dashboard/dist/`. All `/api/*` requests are forwarded to the dashboard
# Worker via the Service Binding declared below.
#
# `production_branch = "main"` means every push to main triggers a Pages
# build. In practice the fluxtube-deploy workflow runs `wrangler pages
# deploy` explicitly after a release, so the branch is more of a naming
# convention than an active trigger.
#
# Deployment source (`build_config.build_command` etc.) is intentionally
# left null — this project is deployed via `wrangler pages deploy`, not
# via Cloudflare's built-in git integration. Setting either would create a
# duplicate deploy path.

resource "cloudflare_pages_project" "dashboard" {
  account_id        = var.cloudflare_account_id
  name              = local.pages_project_name
  production_branch = "main"

  # Deployment config governs the runtime environment Pages Functions run
  # in — the Astro build here is fully static, but we still declare
  # `compatibility_flags` + service bindings so the dashboard Worker is
  # reachable via env.DASHBOARD_WORKER-style invocations if any Pages
  # Functions get added later.
  #
  # The critical binding is the same-origin routing: Cloudflare Pages
  # supports `_routes.json` in the deployed output to send /api/* to the
  # Worker configured via env.DASHBOARD service binding. See
  # dashboard/public/_routes.json (added in the same PR as this file).
  deployment_configs = {
    production = {
      compatibility_date  = "2025-05-01"
      compatibility_flags = ["nodejs_compat"]

      services = {
        DASHBOARD = {
          service     = cloudflare_workers_script.dashboard.script_name
          environment = "production"
        }
      }
    }
    preview = {
      compatibility_date  = "2025-05-01"
      compatibility_flags = ["nodejs_compat"]

      services = {
        DASHBOARD = {
          service     = cloudflare_workers_script.dashboard.script_name
          environment = "production"
        }
      }
    }
  }
}
