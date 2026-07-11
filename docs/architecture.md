# FluxTube — Architecture

Deep-dive on the design. README.md has the elevator pitch; CLAUDE.md is the canonical agent-facing reference. This file is for humans who want to know *why* something is shaped a particular way.

---

## Goals and non-goals

**Goal:** preserve a YouTube-native viewing experience (offline downloads, cross-device progress sync) while removing the manual step of copying RSS-discovered YouTube videos into a playlist. The user keeps reading in Miniflux and watching in YouTube; FluxTube glues the two together.

**Non-goals** (explicitly out of scope; will be rejected without a new requirements discussion):

- Downloading or re-hosting videos.
- Modifying / uploading videos.
- Multi-user support within a single instance (multi-instance IS supported — `var.instance_id` prefixes every Terraform-managed resource so a single Cloudflare account can host N independent FluxTube deployments).
- A general-purpose UI. The v1 dashboard PWA at `dashboard/` handles operator configuration + backups only; anything richer is out of scope.
- Custom alerting channels beyond Healthchecks.io and Grafana.
- Watch Later (`WL`) — not API-accessible since August 2016.
- Migration tooling between RSS readers.
- Handling non-YouTube video URLs.

---

## Composition

```
                    ┌───────────────────────────────────────┐
                    │  Sync Worker (workers/sync)           │
                    │  scheduled(*/30)  ──── runSync        │
                    │  fetch(POST /sync)                    │
                    │  fetch(GET  /audit)                   │
                    └──────────────┬────────────────────────┘
                                   │
                    ┌──────────────┴────────────────────────┐
                    │                                       │
                    ▼                                       ▼
   ┌─────────┐  ┌─────────────┐  ┌─────────────────────┐  ┌──────────┐  ┌──────────┐
   │ Miniflux│  │   YouTube   │  │ D1 (fluxtube-<inst>)│  │  HC.io   │  │  Grafana │
   │  REST   │  │  Data API   │  │  queue + v1 tables  │  │ (×3 chk) │  │  Loki +  │
   │         │  │   (OAuth)   │  │                     │  │          │  │  OTLP    │
   └─────────┘  └─────────────┘  └──────────┬──────────┘  └──────────┘  └──────────┘
                                            │
                    ┌───────────────────────┴──────────────┐
                    │  Dashboard Worker (workers/dashboard)│
                    │  fetch  → Hono routes /api/*         │
                    │  scheduled(15 4) → R2 backup         │
                    └──────────────┬───────────────────────┘
                                   │
                    ┌──────────────┴─────────┐
                    ▼                        ▼
       ┌─────────────────────────┐  ┌────────────────────┐
       │ Pages (dashboard PWA)   │  │  R2 backups bucket │
       │  Service Binding →      │  │ fluxtube-<inst>-   │
       │  Dashboard Worker.fetch │  │ backups            │
       └─────────────────────────┘  │ (120-day lifecycle)│
                                    └────────────────────┘
```

Every component except D1 + R2 is external; D1 + R2 are the only state FluxTube owns. Both Workers share the D1 database. Terraform-managed resource names are prefixed with `var.instance_id` — a single Cloudflare account can host N independent instances.

---

## Pass 1 / Pass 2 algorithm

Two sequential passes per run. The split is intentional — Pass 1 only adds, Pass 2 only removes — so the worst-case end state is recoverable even if one pass fails mid-way.

### Pass 1 — add new videos

For each `(category, playlist, skip_shorts?)` in the mapping:

1. Resolve category name → ID via Miniflux's `/v1/categories`.
2. Fetch unread entries in that category, paginated 100 at a time, **oldest first** so playlist order is chronological.
3. Fetch current YouTube playlist contents (once per unique `playlist_id` per run, cached).
4. For each entry, parse the URL with `extractVideo(url)` → `{ videoId, isShort } | null`:
   - If parse fails → log `not_a_youtube_url` and continue (channel pages, malformed links, etc.).
   - If `pair.skipShorts && isShort` → `miniflux.markRead([entry.id])`, log `skipped_short`, continue.
   - If `state.exists(entry.id, playlist_id)` → log `skipped_tracked`, continue.
   - If `videoId` is already in the playlist → backfill the D1 row using the real `playlistItemId` from the `playlistItems.list` response, log `tracked_existing_in_playlist`, continue. *(Handles the user adding videos manually and prior-run D1 rows that were lost.)*
   - Otherwise: `youtube.insertPlaylistItem(playlist_id, videoId)`, then `state.insert(...)`, log `added`. **Push the new item into the cached playlist list** so Pass 2 doesn't immediately think it's missing.

`VideoUnavailableError` (404 / 403 on insert — video is private / deleted / region-locked) is caught and treated as terminal: `miniflux.markRead([entry.id])`, log `skipped_unavailable`. The 4xx tells us the entry will never be watchable.

`FatalError` (`quota_exhausted`, `invalid_grant`) escapes; the top-level handler pings the failure URL and rethrows.

### Pass 2 — detect removals across all tracked playlists

For each distinct `playlist_id` in D1:

1. Fetch the playlist's current videos.
2. Load all tracked rows for that playlist.
3. For each tracked row whose `youtubeVideoId` is **not** in the current playlist (the user removed it):
   - Determine if this is the entry's last tracking row via `state.hasOtherRowsForEntry(entry_id, playlist_id)`.
   - If yes → `miniflux.markRead([entry_id])` **first**, then `state.delete(entry_id, playlist_id)`.
   - If no → just `state.delete(...)`; the entry stays unread because another playlist still tracks it.

The mark-read-before-delete order is load-bearing. The earlier version of this code did `state.delete()` then `markRead()`; a transient Miniflux 5xx between the two left the entry unread forever with no D1 record to drive a retry. The current order means a failed mark-read leaves the D1 row in place and the next Pass 2 tries again. `MinifluxEntryNotFoundError` (404 — the entry was rotated out of the Miniflux feed) is treated as a clean miss: delete the row and continue.

---

## Why D1 (not KV, not in-memory)

The mark-read decision depends on a relational question: *"does any tracking row still exist for entry X across **any** playlist?"* Compound primary key `(miniflux_entry_id, youtube_playlist_id)`, plus an index on each column individually, supports both halves:

- `hasOtherRowsForEntry(entry_id, exclude_playlist_id)` for the mark-read predicate.
- `rowsForPlaylist(playlist_id)` for Pass 2 iteration.
- `allPlaylistIds()` for Pass 2's outer loop.

KV would require maintaining hand-rolled reverse indexes per write. In-memory is impossible because Workers are stateless across invocations and we'd lose the link between runs.

D1 storage is negligible — 5 GB free tier, FluxTube uses kilobytes. Rows are never pruned in v1.

```sql
CREATE TABLE queue (
  miniflux_entry_id   INTEGER NOT NULL,
  youtube_video_id    TEXT    NOT NULL,
  youtube_playlist_id TEXT    NOT NULL,
  playlist_item_id    TEXT    NOT NULL,
  added_at            INTEGER NOT NULL,
  PRIMARY KEY (miniflux_entry_id, youtube_playlist_id)
);
CREATE INDEX idx_queue_video    ON queue(youtube_video_id);
CREATE INDEX idx_queue_playlist ON queue(youtube_playlist_id);
```

---

## Idempotency invariants

Every external write is safe to retry:

- Before `youtube.insertPlaylistItem` we check D1 (`state.exists`) and the cached playlist contents. So a re-run with the same input doesn't add duplicates.
- Before `miniflux.markRead` we check that this is the entry's last D1 row. So a re-run can't mark an entry read prematurely.
- `D1` `INSERT` uses `ON CONFLICT(...) DO NOTHING` so a re-run is a no-op.

The only externally visible side-effect FluxTube can produce in error is a video the user already removed from the playlist getting re-added on the next tick. That happens only if Pass 1 sees an unread entry that has no D1 row and whose video is not in the playlist — and Pass 2 only deletes D1 rows on user-removal, so this path is narrow.

---

## v1 additions — dashboard, dual-mode config, encryption, backups

### Dual-mode runtime config

The sync Worker's `runtime_config.ts` picks between two config sources based on a single guard:

```ts
async function isD1Managed(env: Env): Promise<boolean> {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM admin_passkey").first<{n:number}>();
  return (r?.n ?? 0) > 0;
}
```

- **D1-managed** (a passkey has been claimed): mappings + Miniflux instances + the YouTube refresh token all read from D1 (`mappings`, `miniflux_instances`, `config.youtube_refresh_token` decrypted). Multiple Miniflux instances supported. Env bindings for legacy fields are **ignored**.
- **Env-managed** (no passkey row): fall back to `CATEGORY_PLAYLIST_MAPPING` + `MINIFLUX_*` env bindings. Single-Miniflux only. Same shape as v0.x.

The env-managed path exists for cold-start / recovery — the first cron tick after `terraform apply` on a fresh instance is env-managed until the operator claims the passkey via the dashboard.

### Encryption at rest

Every sensitive D1 column carries a `_ct` / `_iv` / `_kv` triple:

- `_ct` — base64 AES-GCM ciphertext
- `_iv` — base64 12-byte IV, fresh per write
- `_kv` — integer key version

The `D1_KEYCHAIN` Worker secret is a JSON object shaped `{ "current": 2, "keys": { "1": "<b64 key>", "2": "<b64 key>" } }`. Encryption uses `current`; decryption accepts any listed version. Rotation:

1. Add key `n+1` to the keychain via Bitwarden → wrangler secret put.
2. Bump `current` to `n+1`; redeploy.
3. `POST /api/config/rotate-keys` — the dashboard Worker walks every encrypted row, re-encrypts under `n+1`, writes back.
4. Once the next backup confirms no rows still reference the old key version, remove key `n` from the keychain.

`workers/dashboard/src/crypto.ts` owns encrypt + decrypt. `workers/sync/src/crypto.ts` mirrors the decrypt half for read-side use.

### R2 backups

`workers/dashboard/src/backup.ts` runs on the dashboard Worker's `15 4 * * *` cron (offset from the sync Worker's `*/30 * * * *` to avoid CPU contention on tick boundaries) and on `POST /api/backup/now`.

- **Bucket** — `fluxtube-<instance_id>-backups`, 120-day lifecycle expiration (Terraform-managed).
- **Object key** — `fluxtube-state_YYYY-MM-DD_HH-MM-SS.json` (UTC).
- **Payload** — zod-validated on write AND read. Schema version 1 includes `miniflux_instances` (URLs only; **api tokens excluded**), `mappings`, `mapping_history`, and non-sensitive `config` rows.
- **Explicit exclusions** — `admin_passkey` (WebAuthn state corruption risk on restore), `config.youtube_refresh_token` (ephemeral; re-auth via the dashboard), `miniflux_instances.api_token_*` (re-prompt on restore, symmetric with YouTube).
- **Restore** — `POST /api/backup/restore/:filename` runs a D1 transaction: wipe replaceable tables → re-insert from payload → resolve foreign-key IDs → commit. The UI then walks the operator through re-supplying every Miniflux + YouTube token.
- **Metrics** — `fluxtube_backup_runs_total{outcome}`, `fluxtube_backup_last_success_seconds`, `fluxtube_backup_size_bytes` ship via the same OTLP path as the sync Worker's metrics.

### Dashboard Worker route surface

The dashboard Worker uses Hono. Full route map in `workers/dashboard/src/routes/`. Auth on every `/api/*` route is either a signed session cookie (from a passkey ceremony) or `Authorization: Bearer <MANUAL_TRIGGER_TOKEN>`.

- **Auth**: `/api/auth/passkey/{register,authenticate}/{begin,finish}`, `/api/auth/recovery` (single-use hashed recovery code wipes `admin_passkey`), `/api/auth/logout`, `/api/me`
- **YouTube OAuth**: `/api/auth/youtube` (302 to Google), `/api/auth/youtube/callback` (exchange + persist encrypted refresh_token, 302 back to `/dashboard/settings`)
- **Config**: `/api/miniflux/instances` (CRUD), `/api/miniflux/categories?instance_id=N` (live via decrypted token), `/api/youtube/playlists` (live), `/api/mappings` (grouped view + full-replace save), `/api/mappings/history` (last N snapshots + restore), `/api/config/rotate-keys`
- **Ops**: `/api/sync/trigger` (invokes sync Worker via Service Binding), `/api/backup/{now,restore/:file,list}`, `/api/backup/:filename` (download)

### Cross-instance dedup

The v1 sync algorithm treats YouTube as the source of truth for "already added":

- Pass 1's `playlistItems.insert` catching a 409 → "already added"; mark the Miniflux entry read on **every** instance that included it.
- Pass 2 walking a playlist's contents → for any tracked video not in the playlist, mark-read the entry on every instance that has it.

The mapping table's compound uniqueness (`miniflux_instance_id, miniflux_category, youtube_playlist_id`) makes "which instances included this?" a straight join.

---

## YouTube API quota budget

10,000 units per day default. Per operation:

| Operation | Cost | Frequency |
|---|---|---|
| `playlistItems.list` | 1 | Once per unique playlist per run |
| `playlistItems.insert` | 50 | Once per new video |

At 48 runs/day with moderate volume (~10 new videos), expected daily burn is well under 1,000 units. The Worker aborts the current run with `FatalError('quota_exhausted')` if it crosses 8,000 — that gives a 20% reserve for the rest of the day.

Two things we explicitly *don't* do:

- Never call `search.list` (100 units, not needed).
- Never call `playlistItems.delete` — the user removes videos from the playlist; that's the signal we listen for.

---

## Failure modes and recovery

| Failure | Symptom | Recovery |
|---|---|---|
| YouTube refresh token revoked | `invalid_grant` in logs → `HEARTBEAT_URL_AUTH/fail` fires within one tick | Sign into `/dashboard/settings` → **Reconnect YouTube** (walks OAuth, writes fresh token to D1 encrypted). Post-verification the token no longer expires on a fixed cycle. |
| YouTube quota exhausted | `quota_exhausted` → `HEARTBEAT_URL_QUOTA/fail` | Wait until midnight Pacific; quota resets daily |
| Miniflux transient 5xx mid-run | One or more `entry_processing_failed` / `removal_processing_failed` log lines; run continues | Next cron tick picks up where this one left off |
| Video unavailable on YouTube (private / deleted) | `skipped_unavailable` log line; entry marked read | Nothing to do — terminal state |
| Miniflux entry deleted while still in D1 | `entry_gone_from_miniflux` log line; D1 row cleaned up | Nothing to do — terminal state |
| D1 transient error | One log line per failed row; run continues | Idempotent, next tick reconciles |
| Worker cron didn't fire | Healthchecks.io main check goes red after 35 min | Check Cloudflare dashboard → Cron Triggers |

The **`/audit`** endpoint is the operator's tool for reconciling drift after these failures. It returns a per-pair JSON dump showing, separately:

- Miniflux entries unread but not in D1 and not in the playlist (Pass 1 hasn't added them yet).
- Miniflux entries unread but already in the playlist with no D1 row (backfill candidate).
- D1 rows whose video isn't in the playlist (pending Pass 2 cleanup).
- Entries with unparseable URLs.
- D1 playlist IDs that aren't in the current mapping (orphans from config rotation).

---

## Logging and observability

Every significant event emits one JSON line to stdout, structured:

```json
{"ts":"2026-06-02T07:30:00.000Z","level":"info","event":"added","entry_id":12345,"video_id":"abc...","playlist_id":"PL..."}
```

When `GRAFANA_LOKI_URL` / `_USER` / `_TOKEN` are set, every line is also fanned out to Grafana Cloud Loki via the `LokiSink` (see `workers/sync/src/logsink.ts`):

- Buffered in memory during the run.
- Flushed via `ctx.waitUntil(fetch(...))` at end-of-run (success **or** fatal).
- One stream per invocation, labels `{app: "fluxtube", env: "production", run_id: "<uuid>"}`.
- Fire-and-forget; a Loki outage logs `loki_push_failed` at warn and never affects the sync.

See `docs/observability.md` for query examples.

---

## Cron + manual trigger split

The `scheduled` handler is the production driver: every 30 minutes, Cloudflare Cron Triggers fires it. The `fetch` handler exists for operator actions and is reached on the `workers.dev` subdomain with Bearer auth.

Critical separation: the **`fetch` handler does not ping Healthchecks**. The dead-man's switch is exclusively the cron's signal. Pinging it from a manual call would mask a stuck schedule.

---

## Why Cloudflare (not AWS Lambda or self-hosted)

The decision was three things:

1. **Fewer primitives.** Workers + D1 + Cron + R2 (for TF state) is four resources, all in one console. The equivalent on AWS is Lambda + EventBridge + DynamoDB + S3 + IAM glue.
2. **The data model fits D1 better than DynamoDB.** "Does any row exist for entry X across all playlists?" is a one-line SQL query in D1 and requires a GSI in DynamoDB.
3. **No cold start on cron.** V8 isolates start in microseconds. Every cron tick is fast.

The Workers free tier's 10ms CPU limit is irrelevant here — almost all wall time is `fetch()` I/O, which doesn't count against CPU. If profiling ever shows CPU pressure, $5/mo Workers Paid lifts it to 30s.

---

## What lives where

| Source of truth | Owns |
|---|---|
| This repo (public) | Worker source, Terraform code, dashboards + alerts JSON, release-please config |
| The deploy companion (private) | The values Terraform consumes (CF account ID, R2 bucket, etc.), the secrets the Worker reads, the deploy workflow that stitches it all together |
| Terraform HCL (here, applied from the deploy companion) | All Cloudflare resources: D1, Worker script, cron trigger, plain_text bindings |
| Wrangler (`wrangler deploy --keep-vars`, run by the deploy companion's workflow) | The Worker's JS bundle. `--keep-vars` means Terraform's plain_text bindings survive every deploy |
| Dashboard `POST /api/auth/youtube` flow (v1) | Runs the YouTube OAuth handshake in-browser after the operator signs into the dashboard PWA. The dashboard Worker exchanges the code with Google, encrypts the refresh token under the D1 keychain, and writes it to `config.youtube_refresh_token`. |

Nothing sensitive is ever committed to this repository or persisted on disk after a script run completes.

## How the public + private split works

The deploy companion runs a workflow that listens for `repository_dispatch` events from this repo's `notify-deploy.yml`. On receipt, it:

1. Checks out **itself** for `backend.hcl`, `terraform.tfvars`, ops scripts.
2. Checks out **this repo at the released tag** for Terraform code, Worker source, and `docs/grafana/`.
3. Runs `terraform init -backend-config=$private/backend.hcl` against this repo's HCL.
4. Runs `terraform apply` with `TF_VAR_*` env vars sourced from its own GitHub Secrets.
5. Runs `wrangler deploy --keep-vars --define VERSION:'"X.Y.Z"'` against the checked-out Worker source.
6. Runs `pnpm sync-grafana` against the checked-out dashboards + alerts.
7. Pushes an OTLP `fluxtube.deploys` metric attributing the deploy.

The compromise model: this repo holds **one secret**, `DEPLOY_DISPATCH_TOKEN`, scoped to fire dispatches on the deploy companion only. Leaking it lets an attacker re-deploy already-released code; it does not grant the ability to deploy arbitrary code.
