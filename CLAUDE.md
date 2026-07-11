# FluxTube

Context file for AI coding agents working on this repository. Humans: see `README.md`.

## Purpose

FluxTube is a serverless sync job that bridges [Miniflux](https://miniflux.app) (RSS reader) with YouTube playlists. It reads unread YouTube entries from configured Miniflux categories, adds them to mapped YouTube playlists, and marks Miniflux entries as read once the user has watched and removed them from the playlist on YouTube.

This is the **public source repo**. It holds the Worker source, tests, Terraform module, dashboards-as-code, and release flow. Production deploys happen in a separate **private deploy companion** repo that holds account-specific values and the secrets they resolve from.

## Architecture

```
public (this repo)              private (deploy companion)
  workers/sync/         ───┐    backend.hcl values
  infrastructure/tf/    ───┤    GitHub Secrets (CF, Grafana, ...)
  docs/grafana/         ───┤    deploy-on-release.yml
  release-please           │
       ↓                   │
  tag v0.X.Y + release     │
       ↓                   │
  notify-deploy.yml ─────dispatch───→ deploy-on-release.yml
                                       ├── terraform apply
                                       ├── wrangler deploy --define VERSION
                                       ├── sync-grafana
                                       └── push OTLP deploy metric
```

The deploy workflow does a "two-checkout dance": it checks out the deploy companion (for backend.hcl + secrets) AND this repo (for Terraform code + Worker source + dashboards) at the released ref, then stitches them at runtime.

See `docs/architecture.md` for the deeper algorithmic dive (Pass 1 / Pass 2, D1 schema, quota budget).

## Tech Stack

Pinned versions — don't drift without explicit instruction:

- **Runtime:** Cloudflare Workers (V8 isolate, not Node.js)
- **Language:** TypeScript 6.x in strict mode
- **State:** Cloudflare D1 (SQLite)
- **Scheduling:** Cloudflare Cron Triggers
- **Monorepo:** pnpm workspaces (`workers/sync`, `scripts`)
- **IaC:** Terraform >= 1.9 with Cloudflare provider (~> 4.0)
- **Terraform state:** CF R2 via the S3 backend (fully partial — all values supplied at `terraform init` time)
- **CI/CD:** GitHub Actions
- **Versioning & releases:** SemVer 0.x.x via [release-please](https://github.com/googleapis/release-please) reading Conventional Commits
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
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── tsconfig.base.json
├── eslint.config.js, .prettierrc, .gitignore
├── release-please-config.json
├── .release-please-manifest.json
├── .github/
│   ├── workflows/
│   │   ├── pr-checks.yml             # PR: typecheck + lint + test + audit
│   │   ├── terraform-check.yml       # PR: terraform fmt + validate
│   │   ├── release-please.yml        # push to main → release PR
│   │   └── notify-deploy.yml         # release published → dispatch to deploy repo
│   └── dependabot.yml
├── docs/
│   ├── architecture.md               # design deep-dive
│   ├── observability.md              # LogQL + PromQL recipes
│   ├── setup.md                      # local-dev quick start
│   └── grafana/
│       ├── dashboards/               # JSON dashboards; pushed by deploy repo's sync-grafana
│       └── alerts/                   # JSON alert rules
├── infrastructure/terraform/
│   ├── _modules/fluxtube-environment/
│   │   ├── d1.tf
│   │   ├── worker.tf                 # Worker script + cron trigger (gated by var.cron_enabled)
│   │   ├── variables.tf
│   │   ├── outputs.tf
│   │   └── locals.tf
│   └── environments/production/
│       ├── main.tf                   # fully partial s3 backend
│       ├── variables.tf
│       ├── terraform.tfvars.example
│       └── backend.hcl.example
├── scripts/
│   ├── sync-grafana.ts               # push dashboards + alerts to Grafana
│   └── package.json
├── site/                             # fluxtube.forklabs.cc — Astro static site
│   ├── astro.config.mjs              # Astro 6.x, MDX, static output
│   ├── package.json                  # @fluxtube/site
│   ├── tsconfig.json
│   ├── public/                       # robots.txt, .well-known/security.txt
│   └── src/
│       ├── layouts/BaseLayout.astro  # shared shell, OG + Twitter meta
│       ├── styles/global.css         # design tokens (Fraunces + IBM Plex Mono, ink-red accent)
│       └── pages/
│           ├── index.astro           # landing
│           ├── 404.astro
│           ├── privacy.astro         # required for Google OAuth verification
│           └── terms.astro           # required for Google OAuth verification
└── workers/sync/
    ├── package.json
    ├── tsconfig.json
    ├── wrangler.toml                 # placeholder D1 UUID; Terraform sets the real binding
    ├── vitest.config.ts
    ├── .dev.vars.example
    ├── migrations/0001_initial.sql
    ├── src/
    │   ├── index.ts                  # scheduled + fetch handlers
    │   ├── sync.ts                   # core sync (returns RunSummary)
    │   ├── router.ts                 # POST /sync, GET /audit
    │   ├── audit.ts
    │   ├── miniflux.ts, youtube.ts, state.ts
    │   ├── config.ts                 # mapping parse, extractVideo
    │   ├── heartbeat.ts
    │   ├── logger.ts, logsink.ts, metricsink.ts
    │   ├── globals.d.ts              # declare const VERSION: string (--define injected)
    │   └── types.ts
    └── test/                         # 99 tests, vitest-pool-workers
```

## Conventions

- **Commits**: Conventional Commits. `feat:`, `fix:`, `chore:`, `docs:`, `ci:`, `refactor:`, `test:`. release-please reads these and proposes version bumps.
- **0.x track**: `bump-minor-pre-major: true`. `feat:`/`fix:` map to minor/patch; breaking changes stay minor until you explicitly graduate to 1.0.
- **Strictness**: `"strict": true`. No implicit any. No non-null assertions (`!`) — narrow properly.
- **Naming**: `camelCase` vars/funcs, `PascalCase` types, `SCREAMING_SNAKE_CASE` env-backed constants.
- **No barrel files** (`index.ts` re-exports) except the Worker entrypoint. Import from source files directly.
- **Logging**: One JSON line per significant event. Required fields: `ts`, `level`, `event`, `version`. No `console.log` outside `logger.ts`.
- **Versioning surface**: The build-time `VERSION` constant (declared in `src/globals.d.ts`) is replaced by wrangler `--define VERSION:'"X.Y.Z"'` at deploy. It stamps every log line, Loki stream label, and OTLP `service.version` resource attribute.
- **Testing**: Vitest with `@cloudflare/vitest-pool-workers`. Mock `fetch` via `vi.stubGlobal`. No live network calls in CI.
- **No `any`**. Use `unknown` for external JSON, narrow with type guards.
- **Terraform**: `terraform fmt -recursive` clean at all times. CI enforces.
- **No real identifiers in tracked files**: D1 UUID in `wrangler.toml` is a placeholder; Terraform sets the real binding. No backend bucket name, no account ID, no real instance URL anywhere committed.

## Public-side CI

| Workflow              | Trigger                                       | What                                                                                         |
| --------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `pr-checks.yml`       | PR                                            | typecheck + lint + test + audit on the Worker package                                        |
| `terraform-check.yml` | PR with `infrastructure/terraform/**` changes | `terraform fmt -check` + `validate` (no creds needed)                                        |
| `release-please.yml`  | push to main                                  | Maintains the release PR via Conventional Commits                                            |
| `notify-deploy.yml`   | `release: published`                          | Fires `repository_dispatch` of type `deploy-release` to the configured deploy companion repo |

Auth surface: this repo holds **exactly one secret**, `DEPLOY_DISPATCH_TOKEN`, a fine-scoped PAT with `repository_dispatch:write` on the deploy companion repo only. Compromise lets an attacker redeploy already-released code — nothing more.

## What lives in the deploy companion (not here)

- Backend.hcl with real R2 bucket + endpoint
- Real CF account ID, Worker secrets, Grafana API token, Healthchecks ping URLs
- `deploy-on-release.yml` (consumes the dispatch, runs `terraform apply` + `wrangler deploy` + `sync-grafana`)
- Manual `terraform-apply.yml` workflow
- Ops scripts that touch a password manager
- Operator runbook with vendor-specific instructions

## Operational notes worth knowing

- **`workers/sync/wrangler.toml`'s `database_id`** is intentionally `00000000-…`. Terraform sets the real binding via `cloudflare_workers_script.d1_database_binding` on the deployed Worker. Local `wrangler dev --remote` against your own D1 needs a personal gitignored `wrangler.local.toml` override.
- **YouTube OAuth refresh tokens no longer expire on a fixed cycle** — the Google Cloud OAuth app is published to In Production (Google-verified). The v1 dashboard's `/api/auth/youtube` flow is now the primary path for minting refresh tokens; they land in D1 encrypted under `config.youtube_refresh_token`. The old `scripts/oauth-bootstrap.ts` local-CLI flow is retired.
- **Cron triggers fire at most once per minute.** Default is every 30 minutes.
- **No `playlistItems.delete` calls** — the user removes videos from the playlist manually; that's the signal Pass 2 listens for.

## Non-goals

Out of scope; will be rejected without a new requirements discussion:

- Downloading videos, replacing YouTube's offline feature, uploading or modifying videos
- Multi-user support
- A UI beyond `wrangler tail`, D1 inspection, `/audit`, and Grafana
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
