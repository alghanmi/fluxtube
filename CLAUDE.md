# FluxTube

Context file for AI coding agents working on this repository. Humans: see `README.md`.

## Purpose

FluxTube is a serverless sync job that bridges [Miniflux](https://miniflux.app) (RSS reader) with YouTube playlists. It reads unread YouTube entries from configured Miniflux categories, adds them to mapped YouTube playlists, and marks Miniflux entries as read once the user has watched and removed them from the playlist on YouTube.

Since v1.0.0 (2026-07-11) the runtime has two Workers instead of one:

- **`workers/sync`** — the cron-driven sync job (existing since v0.x).
- **`workers/dashboard`** — an HTTP API Worker fronting a passkey-gated PWA (`dashboard/`) for runtime configuration + nightly R2 backups.

Both Workers share one D1 database. The dashboard PWA lets the operator manage Miniflux instances, YouTube playlist mappings, and encrypted-at-rest secrets without a redeploy.

This is the **public source repo**. It holds the Worker + dashboard source, tests, Terraform module, dashboards-as-code, and release flow. Deployment happens outside this repository; nothing here holds an account-specific value or a credential beyond the release dispatch token.

## Architecture

```
this repo
  workers/sync/, workers/dashboard/, dashboard/, site/
  infrastructure/terraform/   (module + production env, fully partial backend)
  docs/grafana/               (dashboards + alerts as JSON)
  release-please
       ↓
  tag vX.Y.Z + release
       ↓
  release-please.yml / notify-deploy.yml ──repository_dispatch──→ DEPLOY_TARGET_REPO
                                                                 (deployment, outside this repo)
                                                                 ├── terraform apply
                                                                 ├── wrangler deploy (sync, dashboard) --define VERSION
                                                                 ├── wrangler pages deploy
                                                                 └── sync-grafana (optional)
```

The deploy steps and their order are in `docs/architecture.md` → _Deploying a release_.

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
│   │   └── notify-deploy.yml          # manual: re-send the deploy dispatch for an existing tag
│   └── dependabot.yml
├── docs/
│   ├── architecture.md                # design deep-dive (Pass 1/2, D1, dual-mode, crypto, backups)
│   ├── observability.md               # LogQL + PromQL recipes + grafana sync workflow
│   ├── setup.md                       # local-dev quick start
│   └── grafana/
│       ├── dashboards/                # JSON dashboards; pushed by scripts/sync-grafana.ts at deploy time
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
│   ├── sync-grafana.ts                # push dashboards + alerts to Grafana (run at deploy time)
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
│   ├── vitest.config.ts               # happy-dom component tests for the islands
│   ├── src/                           # pages, Preact islands, Service Binding calls
│   └── test/
└── workers/
    ├── sync/
    │   ├── package.json               # @fluxtube/sync
    │   ├── tsconfig.json
    │   ├── wrangler.toml              # placeholder D1 UUID; Terraform sets the real binding
    │   ├── vitest.config.ts
    │   ├── .dev.vars.example
    │   ├── migrations/
    │   │   ├── 0001_initial.sql       # queue table
    │   │   ├── 0002_v1_init.sql       # v1 tables: miniflux_instances, mappings, mapping_history,
    │   │   │                          #            config, admin_passkey
    │   │   └── 0003_config_mode.sql   # durable D1-managed flag (survives recovery wipes)
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
- **Issues are published documents.** This repo is public, so an issue is indexed, quoted in notification email, and permanent — editing it does not unsend the mail. The same scrubbing that applies to commits and PRs applies to issue titles, bodies, and comments, and issues are the easiest surface to get wrong because prose invites explaining _how things work_. Never name a vault item or field, quote deploy-side config, or describe where the trust boundary sits. **File the symptom here and keep the mechanism out of this repository.** Before opening one, re-read it asking what it tells an attacker that they did not already know.

## Documentation

`README.md` is the manual (shared rule _Documentation: the README is the manual_ below): how it works, the architecture, every root `package.json` script, the Worker secrets and the deploy steps for a self-hosting operator. When a change adds a script, a binding, a secret, a migration rule or a deploy step, update the README in the same PR. `pnpm docs:check` runs in `pr-checks.yml`. `docs/architecture.md` → _Deploying a release_ and the README's deploy section must stay in step.

## Public-side CI

| Workflow              | Trigger                                       | What                                                                                                         |
| --------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `pr-checks.yml`       | PR                                            | typecheck + lint + test + audit across workspaces                                                            |
| `terraform-check.yml` | PR with `infrastructure/terraform/**` changes | `terraform fmt -check` + `validate` (no creds needed)                                                        |
| `release-please.yml`  | push to main                                  | Maintains the release PR; on a release, fires `repository_dispatch` `deploy-release` at `DEPLOY_TARGET_REPO` |
| `notify-deploy.yml`   | manual `workflow_dispatch` (tag)              | Re-sends the same dispatch for an existing tag                                                               |

Auth surface: this repo holds **one credential**, `DEPLOY_DISPATCH_TOKEN`, a fine-scoped PAT that can fire dispatches at the target repository only. Compromise lets an attacker redeploy already-released code — nothing more. `DEPLOY_TARGET_REPO`, the name of the repository the dispatch goes to, is also an environment secret. It grants nothing; it is a secret only so that no workflow or log spells the destination out.

Grafana provisioning (dashboards + alerts under `docs/grafana/`) is pushed by `scripts/sync-grafana.ts` at deploy time, never from this repo's CI: the Grafana API token it needs is not a secret this repo holds. See `docs/observability.md`.

## What does not live here

Real account and resource IDs, Worker secrets, the deploy pipeline, the secrets tooling and the operator runbook all live with the deployment, outside this repository. If a task here seems to need any of them, it belongs there.

## Operational notes worth knowing

- **Both `wrangler.toml`s carry placeholders**. `workers/sync/wrangler.toml`'s `database_id` and `workers/dashboard/wrangler.toml`'s `database_id` + `r2_buckets[].bucket_name` are all `00000000-…` / `fluxtube-placeholder-*`. Terraform sets the real bindings on `cloudflare_workers_script.{sync,dashboard}`; a deploy writes the real values in from `terraform output` immediately before `wrangler deploy` because `--keep-vars` covers `vars`, not bindings.
- **YouTube OAuth refresh tokens no longer expire on a fixed cycle** — the Google Cloud OAuth app is published to In Production (Google-verified). The dashboard's `/api/auth/youtube` flow is the canonical path for minting refresh tokens; they land in D1 encrypted under `config.youtube_refresh_token`. The old `scripts/oauth-bootstrap.ts` local-CLI flow was retired in v1.
- **D1-managed vs env-managed config.** The sync Worker's `runtime_config.ts` checks for `config.config_mode = 'd1'` (written at first claim; migration `0003` backfills it) or, failing that, an `admin_passkey` row. The flag is what keeps a recovery wipe of `admin_passkey` from flipping sync back to env bindings. If D1-managed → all runtime config is read from D1 (one Miniflux instance — the API refuses a second, see #179 — encrypted YouTube token, per-mapping `skip_shorts`). If no → legacy `CATEGORY_PLAYLIST_MAPPING` + `MINIFLUX_*` env bindings still work (single-Miniflux). A claimed dashboard is D1-managed; the env-managed path exists for cold-start / recovery.
- **Encryption at rest.** Every sensitive D1 column has a `_ct` / `_iv` / `_kv` triple. AES-GCM under a JSON keychain in the `D1_KEYCHAIN` Worker secret. Rotation: add the new version as `current` (keep the old one) on both Workers, then `POST /api/config/rotate-keys` or Settings → Encryption (all-or-nothing), then drop the old version. See `docs/encryption-keychain.md`.
- **Cron triggers fire at most once per minute.** Sync default `*/30 * * * *`; backup default `15 4 * * *` (offset from the sync tick to avoid CPU contention).
- **No `playlistItems.delete` calls** — the user removes videos from the playlist manually; that's the signal Pass 2 listens for.

## Non-goals

Out of scope; will be rejected without a new requirements discussion:

- Downloading videos, replacing YouTube's offline feature, uploading or modifying videos
- Multi-user support within a single instance (multi-instance IS supported via a distinct `var.instance_id` per deployment)
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

<!-- shared-conventions-public: v3 (2026-10-23). One source, copied verbatim into
     every public repo's CLAUDE.md. Edit the source and re-sync; never edit a
     copy in place. Repo-specific rules elsewhere in this file override it.
     v3: adds "Documentation: the README is the manual". -->

## Shared conventions (public repository)

**Classification: public.** This repository is public or written to be
published. Every file, commit message, PR, issue, comment and workflow log is
permanent public record: rewriting history does not unsend notification email
or remove a commit reachable from a PR. The rest of this file adds rules for
this repo; where they conflict, the stricter rule wins.

### What never appears here

- **Anything about where or how this project is operated.** No other
  repository that deploys, configures or monitors it is named, linked,
  described or implied. Say only that deployment happens outside this
  repository.
- **The operator's tooling and vendors.** No password manager, secrets store,
  monitoring or hosting account, beyond the services the published source
  itself integrates with.
- **Identifiers.** No hostnames, account or zone IDs, resource UUIDs, bucket
  names, instance URLs, personal paths, or contact details outside a
  deliberate `SECURITY.md`. Configs carry placeholders.
- **The specifics of one deployment's security.** Which of our credentials
  does what, which account or vault item holds it, where our trust boundaries
  sit, what we deliberately leave unmonitored. Describe symptoms and fixes,
  never the map.

### What belongs here

- **The software's security model, in general terms.** `SECURITY.md` and
  docs describe what the project protects and how: authentication,
  encryption at rest, which secrets an operator must provide and why,
  least-privilege token scopes, the threat model, and how to report a
  vulnerability. That is what lets a stranger run it safely. It is written
  for any deployment, never as a description of ours.
- **Tooling that helps a contributor or operator do the work**, under the
  rules below.

Before pushing, read the diff, the commit message and the PR body once with
the question "what does this tell someone who wants to attack the deployment
that they did not already know?"

### Tooling and the Makefile

- **Tooling is welcome; specifics are not.** A `Makefile` and scripts may do
  anything a contributor or a self-hosting operator needs: build, test,
  generate docs, run Terraform, deploy. Every value comes from the
  environment or a gitignored file the operator creates from a committed
  `*.example`; nothing names our accounts, hosts, vault items or other
  repositories. Read every target as a stranger would run it.
- **The Makefile is the interface where one exists.** Each target has a
  `## description` and is listed by `make help` (the first target); README
  usage documents targets, not raw commands. Thin recipes over
  `set -euo pipefail` scripts; `printf`, never `echo -e`; parameters are
  upper-case make variables validated with a working example.
- **No target prompts**, and a target that changes live state without a
  saved, reviewed plan requires `CONFIRM=1`.
- **Common target names**, used whenever the operation exists:
  `help`, `install`, `dev`, `fmt`/`format`, `lint`, `typecheck`, `test`,
  `check` (everything CI runs), `docs`, `tf-check` (`fmt -check` +
  `validate -backend=false`), `tf-upgrade` (provider upgrade + lock for
  `linux_amd64` and `darwin_arm64`), `clean`.
- **CI needs no secret beyond what the release mechanism requires**, and
  the release mechanism's destination is itself a secret: a dispatch target
  is read from `secrets.*`, never written into a workflow.

### Documentation: the README is the manual

- **The README runs the project from a fresh clone.** It covers what the
  project does, its architecture (a Mermaid diagram wherever a flow is easier
  to see than to read), local development, every `make` target or root
  `package.json` script, and how a self-hosting operator deploys it: the
  resources, the secrets to provide, the order. It describes any deployment
  in general terms, never ours.
- **Every change reviews the README.** Before opening a PR, read the README
  sections the change touches against the diff. A new, renamed or removed
  target, script, variable, secret, workflow or deploy step updates the
  README in the same PR, never in a follow-up.
- **`docs-check` enforces the mechanical half** (`make docs-check`, or
  `pnpm docs:check` where there is no Makefile). It fails when a documented
  target or root script is missing from the README, or a relative link points
  at nothing. CI runs it. Only reading catches a stale procedure.

### Git and pull requests

- **Never commit or push to `main`.** Every change starts on a branch from an
  up-to-date `main` and lands through a pull request. No hotfix exception.
- **Branch names** use the Conventional Commit type as prefix:
  `feat/…`, `fix/…`, `chore/…`, `docs/…`, `ci/…`.
- **Squash-merge only.** The PR title becomes the commit subject on `main`,
  so it must be a valid Conventional Commit subject on its own. Commit bodies
  survive the squash, so the reasoning belongs in the commits too.
- **The prefix is a release decision.** `feat:` only for a change a user of
  the released artifact would notice; tooling, CI and docs are
  `chore:`/`ci:`/`docs:`. State the intended bump in the PR.
- **Squash destroys ancestry.** Check whether a branch merged against the PR
  list, never `git rev-list main..HEAD`.
- **Verification happens before the PR opens.** The PR body says which checks
  were run.

### Code

- **No real values in tracked files.** Variables have no defaults that
  encode a real value; backends are fully partial; resource IDs in tool
  configs are placeholders.
- **Terraform:** `fmt -check` and `validate -backend=false` in CI;
  `required_version = ">= 1.10"`; provider lock files committed; outputs read
  attributes off resources, never echo variables.
- **Dependencies:** resolve versions from the registry, never from memory.
  A held-back major gets an `ignore` rule in `.github/dependabot.yml` with
  the reason and an issue for the migration.

### Issues

- **An issue is a published document.** Symptom and fix only; nothing from
  "What never appears here".
- Written for a cold reader: evidence with `file:line`, the change, and a
  closing condition stated as a command.

### Repository hygiene

- `AGENTS.md` is a symlink to `CLAUDE.md`, never a copy.
- Dependabot covers every ecosystem present, including `github-actions`.
- `main` has a ruleset: PRs only, required checks, no force-push or deletion.
- Secret scanning and push protection are on (free for public repos).
