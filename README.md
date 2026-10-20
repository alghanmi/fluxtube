# FluxTube

A pair of Cloudflare Workers that sync unread YouTube entries from [Miniflux](https://miniflux.app) into YouTube playlists, then mark Miniflux entries as read once you've watched and removed them from the playlist. Since v1.0.0 (2026-07-11) FluxTube ships with a passkey-gated dashboard PWA for runtime configuration + nightly R2 backups.

The goal: keep YouTube as the native viewing surface (offline downloads, cross-device progress sync) while eliminating the manual step of copying RSS-discovered links into a playlist.

## How it works

On a cron tick (every 30 minutes by default):

1. For each configured `(category, playlist)` pair, fetch unread Miniflux entries; for each one whose URL is a YouTube video that isn't already in the playlist, call `playlistItems.insert` and record a row in D1.
2. For each tracked row, check whether the video is still in its playlist; if you've removed it, mark the Miniflux entry read and delete the D1 row.

Pass 1 only adds, Pass 2 only removes. See [`docs/architecture.md`](./docs/architecture.md) for the algorithm in detail, plus the v1 additions (dual-mode config, encryption at rest, R2 backups).

## Quick start (local development)

```sh
git clone https://github.com/alghanmi/fluxtube.git
cd fluxtube
pnpm install
pnpm --filter @fluxtube/sync test
pnpm --filter @fluxtube/dashboard test
```

For running the Workers against your own Cloudflare account, you'll need:

- A Cloudflare account with Workers + D1 + R2 + Pages
- A Miniflux instance (self-hosted or [reader.miniflux.app](https://reader.miniflux.app))
- YouTube playlists (PL... — Watch Later is API-disabled)
- A Google Cloud project with YouTube Data API v3 enabled, OAuth 2.0 Web application client
- A registrable domain for the dashboard (WebAuthn RP ID)
- Optional: [Healthchecks.io](https://healthchecks.io/), [Grafana Cloud](https://grafana.com/products/cloud/) for observability

Deployment happens outside this repository — see [Deploying your own instance](#deploying-your-own-instance) below.

## Repo layout

```
.
├── workers/
│   ├── sync/                    # Cron-driven sync Worker — TypeScript, vitest, wrangler
│   └── dashboard/               # HTTP API Worker (Hono + WebAuthn + R2 backups)
├── dashboard/                   # Astro PWA served via Cloudflare Pages → dashboard Worker
├── site/                        # fluxtube.forklabs.cc marketing site (Astro)
├── infrastructure/terraform/    # IaC: two Workers + D1 + R2 + Pages + cron triggers
├── docs/grafana/                # Dashboards + alert rules as code
│   ├── dashboards/
│   └── alerts/
├── scripts/
│   └── sync-grafana.ts          # Push dashboards + alerts to Grafana Cloud
└── .github/workflows/
    ├── pr-checks.yml            # typecheck + lint + test + audit (all workspaces)
    ├── terraform-check.yml      # fmt + validate on PR
    ├── release-please.yml       # version + CHANGELOG management
    └── notify-deploy.yml        # on release → repository_dispatch to DEPLOY_TARGET_REPO
```

## Deploying your own instance

Deployment happens outside this repository. Everything account-specific (the Cloudflare account and resource IDs, the R2 bucket, API tokens, dashboard credentials) is supplied by you at deploy time; nothing in this repo encodes a real value.

What this repo gives a deployment:

- **The Terraform module** in `infrastructure/terraform/`, with a fully partial backend and `*.example` files showing every input.
- **A release hook.** When release-please publishes a release, `notify-deploy.yml` sends a `repository_dispatch` of type `deploy-release` with `{ version, sha, actor, ref }` to the repository named in the `DEPLOY_TARGET_REPO` environment secret, authenticated with `DEPLOY_DISPATCH_TOKEN`. Point it at whatever runs your deploy, or leave both unset and deploy by hand.
- **The deploy steps**, whatever drives them: `terraform apply`, then `wrangler deploy --name <worker> --define VERSION:'"X.Y.Z"'` for both Workers, `wrangler pages deploy` for the dashboard, and optionally `scripts/sync-grafana.ts` for dashboards and alerts.

[`docs/architecture.md`](./docs/architecture.md) explains which tool owns which resource and why.

## Observability

All four surfaces are optional; enable any subset.

| Surface                | What                                               | Configure via                                                |
| ---------------------- | -------------------------------------------------- | ------------------------------------------------------------ |
| **stdout JSON logs**   | Always on, viewable via `wrangler tail`            | —                                                            |
| **Healthchecks.io**    | Cron dead-man's switch + per-reason failure alerts | `HEARTBEAT_URL`, `HEARTBEAT_URL_AUTH`, `HEARTBEAT_URL_QUOTA` |
| **Grafana Cloud Loki** | Structured log shipping                            | `GRAFANA_LOKI_URL` + `_USER` + `_TOKEN`                      |
| **Grafana Cloud OTLP** | 11 gauge metrics per run via OTLP/HTTP JSON        | `GRAFANA_OTLP_URL` + `_USER` + `_TOKEN`                      |

See [`docs/observability.md`](./docs/observability.md) for LogQL + PromQL recipes and the metric reference.

## Contributing

PRs welcome. Conventional Commits (`feat:` / `fix:` / `chore:`). release-please opens a release PR after each commit on `main` — merging it cuts a tag + GH release + CHANGELOG entry, which fires the deploy dispatch if `DEPLOY_TARGET_REPO` is set.

## License

MIT. See [`LICENSE`](./LICENSE).

## Security

See [`SECURITY.md`](./SECURITY.md) for the vulnerability disclosure policy.
