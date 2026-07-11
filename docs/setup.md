# Local development

For contributors and people forking the project. **Deploying your own instance** is a separate flow handled by a deploy companion repo — see [the README](../README.md#deploying-your-own-instance) for that side.

## Prerequisites

- **Node.js 22** (or whatever the latest LTS is)
- **pnpm 10+** (`npm install -g pnpm`, or use [Corepack](https://nodejs.org/api/corepack.html))
- **Wrangler** if you want to run the Worker locally — `pnpm dlx wrangler` works; no install needed
- **Terraform 1.9+** if you want to validate / experiment with the IaC

## Bootstrap

```sh
git clone https://github.com/alghanmi/fluxtube.git
cd fluxtube
pnpm install
```

That's it for read-only / development. The lockfile is committed; `pnpm install --frozen-lockfile` mirrors what CI runs.

## Running tests

```sh
# Sync Worker tests (vitest with @cloudflare/vitest-pool-workers)
pnpm --filter @fluxtube/sync test

# Dashboard Worker tests (Hono routes, WebAuthn ceremonies, R2 backup shape)
pnpm --filter @fluxtube/dashboard test

# Watch mode
pnpm --filter @fluxtube/sync test:watch

# Full CI parity — all workspaces
pnpm typecheck
pnpm lint
pnpm test
pnpm audit --audit-level=high
```

The `pr-checks.yml` workflow runs typecheck + lint + test + audit across every workspace (sync, dashboard-worker, dashboard-web, site, scripts) on every PR.

## Running a Worker locally

`wrangler dev --remote` runs the Worker in Cloudflare's edge network, hitting your account's resources. Useful for end-to-end testing against real D1 / real Miniflux / real YouTube API. Applies to both `workers/sync` and `workers/dashboard`.

**Important:** both Workers' `wrangler.toml` checked into this repo carry **placeholders** — D1 UUID (both), R2 bucket name (dashboard). For `wrangler dev --remote` to actually connect, you need real IDs from your own account. Two ways:

### Option A — personal `wrangler.local.toml` (recommended)

Make a gitignored copy per Worker with your real values:

```sh
cp workers/sync/wrangler.toml workers/sync/wrangler.local.toml
# edit workers/sync/wrangler.local.toml: replace the 0000 UUID with your D1 ID
echo 'workers/sync/wrangler.local.toml' >> .git/info/exclude

# and separately for the dashboard Worker:
cp workers/dashboard/wrangler.toml workers/dashboard/wrangler.local.toml
# edit: replace the 0000 D1 UUID + the fluxtube-placeholder-* R2 bucket name
echo 'workers/dashboard/wrangler.local.toml' >> .git/info/exclude
```

Then point wrangler at it:

```sh
cd workers/sync
pnpm dlx wrangler dev --remote --config wrangler.local.toml
```

### Option B — `--persist-to` for offline state

For testing the sync algorithm without touching real D1, use a local SQLite file:

```sh
cd workers/sync
pnpm dlx wrangler dev --persist-to .wrangler/state
# Run migrations against the local DB once:
pnpm dlx wrangler d1 migrations apply fluxtube-<instance_id> --local
```

The D1 name at runtime is `fluxtube-<instance_id>` (Terraform composes it from `var.instance_id`). Use the same name locally so migrations land in the right database.

## Local secrets

The Worker reads runtime secrets via env at Cloudflare. For local dev, populate `.dev.vars` (gitignored) with whatever you want to set:

```sh
cp workers/sync/.dev.vars.example workers/sync/.dev.vars
# fill in MINIFLUX_API_TOKEN, YOUTUBE_*, etc.
```

Wrangler dev reads `.dev.vars` automatically when running `wrangler dev --remote`.

**Never commit a real `.dev.vars`.** It's already gitignored, but check before you `git add -A`.

## Terraform local validation

```sh
cd infrastructure/terraform/_modules/fluxtube-environment
terraform init -backend=false
terraform validate
```

`terraform fmt -check -recursive` from the root keeps formatting consistent. CI enforces both on every PR.

## Conventional Commits

This repo uses [Conventional Commits](https://www.conventionalcommits.org/). release-please reads commit prefixes and proposes version bumps:

- `feat: ...` → minor bump (or patch if before 1.0 — `bump-minor-pre-major` is on)
- `fix: ...` → patch bump
- `chore:`, `docs:`, `test:`, `ci:`, `refactor:`, `style:` → no bump
- `feat!:` or a `BREAKING CHANGE:` footer → minor bump on 0.x, major on 1.x

Examples of good commit messages:

```
feat(sync): handle YouTube /live URLs in extractVideo
fix(sync): preserve playlist cache between Pass 1 and Pass 2
chore(deps): bump @cloudflare/vitest-pool-workers from 0.16.11 to 0.16.15
docs: clarify the skip_shorts behavior in the README
```

## Submitting changes

Standard GitHub flow: fork, branch, PR. CI runs typecheck + lint + test + audit on every PR via `pr-checks.yml`. For Terraform changes, `terraform-check.yml` runs `fmt -check` + `validate`.

PRs that touch:
- `workers/sync/**` → must keep tests green; new features need new tests
- `infrastructure/terraform/**` → must pass `terraform fmt -check -recursive` + `validate`
- `docs/grafana/**` → JSON files are pushed to Grafana on the next release; validate locally with `jq empty` before pushing

See [`CLAUDE.md`](../CLAUDE.md) for code conventions and the deeper architecture.
