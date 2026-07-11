# FluxTube

Context file for AI coding agents working on this repository. Humans: see `README.md`.

## Purpose

FluxTube is a serverless sync job that bridges [Miniflux](https://miniflux.app) (RSS reader) with YouTube playlists. It reads unread YouTube entries from configured Miniflux categories, adds them to mapped YouTube playlists, and marks Miniflux entries as read once the user has watched and removed them from the playlist on YouTube.

Since v1.0.0 (2026-07-11) the runtime has two Workers instead of one:

- **`workers/sync`** — the cron-driven sync job (existing since v0.x).
- **`workers/dashboard`** — an HTTP API Worker fronting a passkey-gated PWA (`dashboard/`) for runtime configuration + nightly R2 backups.

Both Workers share one D1 database. The dashboard PWA lets the operator manage Miniflux instances, YouTube playlist mappings, and encrypted-at-rest secrets without a redeploy.

This is the **public source repo**. It holds the Worker + dashboard source, tests, Terraform module, dashboards-as-code, and release flow. Production deploys happen in a separate **private deploy companion** repo that holds account-specific values and the secrets they resolve from.

## Architecture

```
public (this repo)              private (deploy companion)
  workers/sync/         ───┐    config/deploy.env (non-secrets)
  workers/dashboard/    ───┤    GitHub Secrets (CF, Grafana, ...)
  dashboard/            ───┤    deploy-on-release.yml
  site/                 ───┤    sync-grafana.yml
  infrastructure/tf/    ───┤
  docs/grafana/         ───┤
  release-please           │
       ↓                   │
  tag vX.Y.Z + release     │
       ↓                   │
  notify-deploy.yml ─────dispatch───→ deploy-on-release.yml
                                       ├── terraform apply (multi-instance)
                                       ├── wrangler deploy (sync)   --define VERSION
                                       ├── wrangler deploy (dashboard) --define VERSION
                                       ├── sync-grafana
                                       └── push OTLP deploy metric
```

The deploy workflow does a "two-checkout dance": it checks out the deploy companion (for `config/deploy.env` + secrets) AND this repo (for Terraform code + Worker source + dashboards) at the released ref, then stitches them at runtime.

See `docs/architecture.md` for the deeper algorithmic dive (Pass 1 / Pass 2, D1 schema, quota budget, dual-mode config, encryption at rest, R2 backups).

## Tech Stack

Pinned versions — don't drift without explicit instruction:

- **Runtime:** Cloudflare Workers (V8 isolate, not Node.js) — two Workers, one D1 shared, one R2 backups bucket
- **Language:** TypeScript 6.x in strict mode
- **State:** Cloudflare D1 (SQLite)
- **Scheduling:** Cloudflare Cron Triggers (sync `*/30`, dashboard `15 4` for backups)
- **Monorepo:** pnpm workspaces — `workers/sync`, `workers/dashboard`, `dashboard`, `site`, `scripts`
- **Dashboard API:** Hono on the Worker; `@simplewebauthn/server` for passkeys; `zod` for backup schema validation
- **Dashboard PWA:** Astro 7.x + Preact islands, calls the dashboard Worker via Service Binding from Pages
- **Encryption:** Web Crypto AES-GCM with a JSON keychain (`D1_KEYCHAIN` secret), key-versioned + rotatable
- **IaC:** Terraform >= 1.9 with Cloudflare provider `~> 5.0` — resource names prefixed with `var.instance_id`
- **Terraform state:** CF R2 via the S3 backend (fully partial — all values supplied at `terraform init` time)
- **CI/CD:** GitHub Actions
- **Versioning & releases:** SemVer 1.x via [release-please](https://github.com/googleapis/release-please) reading Conventional Commits. `bump-minor-pre-major` was dropped when v1.0.0 shipped.
- **Testing:** Vitest with `@cloudflare/vitest-pool-workers`
- **Formatting:** Prettier (default, 2-space indent, single quotes)
- **Linting:** ESLint 10 flat config with `typescript-eslint`

## Repository Layout

```
.
├── README.md
├── CLAUDE.md / AGENTS.md             # this file (mirrored)
├── SECURITY.md
├── LICENSE                            # MIT
├── CHANGELOG.md                       # release-please owned
├── package.json                       # root workspace manifest
├── pnpm-workspace.yaml                # workers/*, scripts, site, dashboard
├── pnpm-lock.yaml
├── tsconfig.base.json
├── eslint.config.js, .prettierrc, .gitignore
├── release-please-config.json         # extra-files: workers/sync + workers/dashboard package.json
├── .release-please-manifest.json
├── .github/
│   ├── workflows/
│   │   ├── pr-checks.yml              # PR: typecheck + lint + test + audit across workspaces
│   │   ├── terraform-check.yml        # PR: terraform fmt + validate
│   │   ├── release-please.yml         # push to main → release PR
│   │   └── notify-deploy.yml          # release published → dispatch to deploy repo
│   └── dependabot.yml
├── docs/
│   ├── architecture.md                # design deep-dive (Pass 1/2, D1, dual-mode, crypto, backups)
│   ├── observability.md               # LogQL + PromQL recipes + grafana sync workflow
│   ├── setup.md                       # local-dev quick start
│   └── grafana/
│       ├── dashboards/                # JSON dashboards; pushed by deploy repo's sync-grafana workflow
│       └── alerts/                    # JSON alert rules
├── infrastructure/terraform/
│   ├── _modules/fluxtube-environment/
│   │   ├── d1.tf                      # cloudflare_d1_database name = fluxtube-<instance_id>
│   │   ├── worker-sync.tf             # sync Worker + cron trigger (gated by var.cron_enabled)
│   │   ├── worker-dashboard.tf        # dashboard Worker + backup cron
│   │   ├── r2.tf                      # backups bucket + 120-day lifecycle
│   │   ├── pages.tf                   # Pages project + service binding to dashboard Worker
│   │   ├── variables.tf               # var.instance_id (required), var.dashboard_domain, ...
│   │   ├── outputs.tf
│   │   └── locals.tf                  # local.prefix = "fluxtube-${var.instance_id}"
│   └── environments/production/
│       ├── main.tf                    # fully partial s3 backend
│       ├── variables.tf
│       ├── terraform.tfvars.example
│       └── backend.hcl.example
├── scripts/
│   ├── sync-grafana.ts                # push dashboards + alerts to Grafana (invoked by deploy repo)
│   └── package.json
├── site/                              # fluxtube.forklabs.cc — Astro 7.x marketing site
│   ├── astro.config.mjs
│   ├── package.json                   # @fluxtube/site
│   ├── tsconfig.json
│   ├── public/                        # robots.txt, .well-known/security.txt, _headers
│   └── src/
│       ├── layouts/BaseLayout.astro
│       ├── styles/global.css          # design tokens (Fraunces + IBM Plex Mono, ink-red accent)
│       └── pages/
│           ├── index.astro            # landing
│           ├── 404.astro
│           ├── privacy.astro          # required by Google OAuth verification
│           └── terms.astro            # required by Google OAuth verification
├── dashboard/                         # dashboard.<instance>.<domain> — Astro PWA
│   ├── astro.config.mjs
│   ├── package.json                   # @fluxtube/dashboard-web
│   └── src/                           # pages, Preact islands, Service Binding calls
└── workers/
    ├── sync/
    │   ├── package.json               # @fluxtube/sync
    │   ├── tsconfig.json
    │   ├── wrangler.toml              # placeholder D1 UUID; Terraform sets the real binding
    │   ├── vitest.config.ts
    │   ├── .dev.vars.example
    │   ├── migrations/
    │   │   ├── 0001_initial.sql       # queue table
    │   │   └── 0002_v1_init.sql       # v1 tables: miniflux_instances, mappings, mapping_history,
    │   │                              #            config, admin_passkey
    │   ├── src/
    │   │   ├── index.ts               # scheduled + fetch handlers
    │   │   ├── sync.ts                # core sync (returns RunSummary)
    │   │   ├── runtime_config.ts      # dual-mode loader (D1-managed vs env-managed)
    │   │   ├── router.ts              # POST /sync, GET /audit
    │   │   ├── audit.ts
    │   │   ├── config.ts              # mapping parse, extractVideo
    │   │   ├── crypto.ts              # AES-GCM decrypt (shared shape with dashboard)
    │   │   ├── repos/                 # D1 repository modules (mappings, config, miniflux_instances, ...)
    │   │   ├── miniflux.ts, youtube.ts, state.ts
    │   │   ├── heartbeat.ts
    │   │   ├── logger.ts, logsink.ts, metricsink.ts
    │   │   ├── globals.d.ts           # declare const VERSION (--define injected)
    │   │   └── types.ts
    │   └── test/                      # vitest-pool-workers
    └── dashboard/
        ├── package.json               # @fluxtube/dashboard
        ├── tsconfig.json
        ├── wrangler.toml              # placeholder D1 UUID + R2 bucket; Terraform sets real bindings
        ├── vitest.config.ts
        └── src/
            ├── index.ts               # Hono app + scheduled handler (nightly R2 backup)
            ├── crypto.ts              # AES-GCM encrypt/decrypt
            ├── backup.ts              # R2 backup generate + restore + list
            ├── auth/                  # WebAuthn ceremonies, session cookies, recovery code
            ├── routes/                # /api/* handlers (mappings, miniflux, youtube, backups, ...)
            ├── repos/                 # D1 repositories shared shape with sync
            ├── metricsink.ts          # OTLP push for backup outcomes
            └── globals.d.ts
```

## Conventions

- **Commits**: Conventional Commits. `feat:`, `fix:`, `chore:`, `docs:`, `ci:`, `refactor:`, `test:`. release-please reads these and proposes version bumps.
- **1.x track**: on the 1.x line since 2026-07-11. `feat!:` / `BREAKING CHANGE:` is a major bump; the `bump-minor-pre-major` flag has been retired.
- **Strictness**: `"strict": true`. No implicit any. No non-null assertions (`!`) — narrow properly.
- **Naming**: `camelCase` vars/funcs, `PascalCase` types, `SCREAMING_SNAKE_CASE` env-backed constants.
- **No barrel files** (`index.ts` re-exports) except the Worker entrypoints. Import from source files directly.
- **Logging**: One JSON line per significant event. Required fields: `ts`, `level`, `event`, `version`, `instance_id`. No `console.log` outside `logger.ts`.
- **Versioning surface**: The build-time `VERSION` constant (declared in each Worker's `src/globals.d.ts`) is replaced by wrangler `--define VERSION:'"X.Y.Z"'` at deploy. It stamps every log line, Loki stream label, and OTLP `service.version` resource attribute.
- **Instance surface**: `INSTANCE_ID` is a plain_text binding on both Workers (set by Terraform from `var.instance_id`). It labels every log line + metric so a single Grafana stack can host multiple FluxTube instances.
- **Testing**: Vitest with `@cloudflare/vitest-pool-workers`. Mock `fetch` via `vi.stubGlobal`. No live network calls in CI.
- **No `any`**. Use `unknown` for external JSON, narrow with type guards.
- **Terraform**: `terraform fmt -recursive` clean at all times. CI enforces.
- **No real identifiers in tracked files**: D1 UUID + R2 bucket name in both `wrangler.toml`s are placeholders; Terraform sets the real bindings. No backend bucket name, no account ID, no real instance URL anywhere committed.

## Public-side CI

| Workflow              | Trigger                                       | What                                                                                         |
| --------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `pr-checks.yml`       | PR                                            | typecheck + lint + test + audit across workspaces                                            |
| `terraform-check.yml` | PR with `infrastructure/terraform/**` changes | `terraform fmt -check` + `validate` (no creds needed)                                        |
| `release-please.yml`  | push to main                                  | Maintains the release PR via Conventional Commits                                            |
| `notify-deploy.yml`   | `release: published`                          | Fires `repository_dispatch` of type `deploy-release` to the configured deploy companion repo |

Auth surface: this repo holds **exactly one secret**, `DEPLOY_DISPATCH_TOKEN`, a fine-scoped PAT with `repository_dispatch:write` on the deploy companion repo only. Compromise lets an attacker redeploy already-released code — nothing more.

Grafana provisioning (dashboards + alerts under `docs/grafana/`) is pushed by a workflow that lives in the **deploy companion**, not here — the API token that powers it is a private-side secret. See `docs/observability.md` for the sync flow.

## What lives in the deploy companion (not here)

- `config/deploy.env` with real account ID, R2 bucket, cron schedule, per-instance vars
- Real CF account ID, Worker secrets (`D1_KEYCHAIN`, `SESSION_SIGNING_KEY`, `RP_ID`, `INSTANCE_ID`, `DASHBOARD_DOMAIN`, `MANUAL_TRIGGER_TOKEN`, YouTube + Miniflux credentials, Grafana + Healthchecks URLs)
- `deploy-on-release.yml` (consumes the dispatch, runs `terraform apply` + `wrangler deploy` for both Workers + `sync-grafana` + deploy metric)
- `terraform-apply.yml` and `sync-grafana.yml` — manual `workflow_dispatch` entrypoints
- Ops scripts that touch a password manager (`sync-github-secrets.sh`, `sync-worker-secrets.sh`, `bootstrap-local-tf.sh`, `trigger-sync.sh`)
- Operator runbook (`TODO.md`, `docs/bootstrap.md`, `docs/cutover-v1.md`, `docs/alerting.md`)

## Operational notes worth knowing

- **Both `wrangler.toml`s carry placeholders**. `workers/sync/wrangler.toml`'s `database_id` and `workers/dashboard/wrangler.toml`'s `database_id` + `r2_buckets[].bucket_name` are all `00000000-…` / `fluxtube-placeholder-*`. Terraform sets the real bindings on `cloudflare_workers_script.{sync,dashboard}`; the deploy workflow `sed`s in the real values immediately before `wrangler deploy` because `--keep-vars` covers `vars`, not bindings.
- **YouTube OAuth refresh tokens no longer expire on a fixed cycle** — the Google Cloud OAuth app is published to In Production (Google-verified). The dashboard's `/api/auth/youtube` flow is the canonical path for minting refresh tokens; they land in D1 encrypted under `config.youtube_refresh_token`. The old `scripts/oauth-bootstrap.ts` local-CLI flow was retired in v1.
- **D1-managed vs env-managed config.** The sync Worker's `runtime_config.ts` checks whether an `admin_passkey` row exists. If yes → all runtime config is read from D1 (multi-Miniflux, encrypted YouTube token, per-mapping `skip_shorts`). If no → legacy `CATEGORY_PLAYLIST_MAPPING` + `MINIFLUX_*` env bindings still work (single-Miniflux). Post-cutover we're D1-managed; the env-managed path exists for cold-start / recovery.
- **Encryption at rest.** Every sensitive D1 column has a `_ct` / `_iv` / `_kv` triple. AES-GCM under a JSON keychain in the `D1_KEYCHAIN` Worker secret. Rotation: bump keychain `current`, redeploy, hit `POST /api/config/rotate-keys`.
- **Cron triggers fire at most once per minute.** Sync default `*/30 * * * *`; backup default `15 4 * * *` (offset from the sync tick to avoid CPU contention).
- **No `playlistItems.delete` calls** — the user removes videos from the playlist manually; that's the signal Pass 2 listens for.

## Non-goals

Out of scope; will be rejected without a new requirements discussion:

- Downloading videos, replacing YouTube's offline feature, uploading or modifying videos
- Multi-user support within a single instance (multi-instance IS supported via distinct `var.instance_id` in the deploy companion)
- Custom alert channels beyond Healthchecks.io and Grafana
- Watch Later (`WL`) — not API-accessible since 2016
- Non-YouTube video URLs

## References

- Miniflux API: https://miniflux.app/docs/api.html
- YouTube Data API v3: https://developers.google.com/youtube/v3
- YouTube API quota costs: https://developers.google.com/youtube/v3/determine_quota_cost
- Cloudflare Workers: https://developers.cloudflare.com/workers/
- Cloudflare D1: https://developers.cloudflare.com/d1/
- Healthchecks.io HTTP API: https://healthchecks.io/docs/http_api/
- release-please: https://github.com/googleapis/release-please
- SimpleWebAuthn (server + browser): https://simplewebauthn.dev/
- Hono: https://hono.dev/
