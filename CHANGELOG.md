# Changelog

## [1.1.0](https://github.com/alghanmi/fluxtube/compare/v1.0.0...v1.1.0) (2026-07-15)


### Features

* **dashboard:** PR-A — logo + favicons + tokens for Phase 10 design pass ([fec33de](https://github.com/alghanmi/fluxtube/commit/fec33dec4dc712ac0e4a08d7f9ffe0e288caccee))
* **dashboard:** PR-A — Phase 10 foundation (logo + favicons + tokens) ([#89](https://github.com/alghanmi/fluxtube/issues/89)) ([fec33de](https://github.com/alghanmi/fluxtube/commit/fec33dec4dc712ac0e4a08d7f9ffe0e288caccee))
* **dashboard:** PR-B — TubeIcon Preact component (14-glyph icon set) ([#90](https://github.com/alghanmi/fluxtube/issues/90)) ([471640e](https://github.com/alghanmi/fluxtube/commit/471640eb4012975c3bc54c7febbd7053b62a22a5))
* **dashboard:** PR-C — MappingEditor Phase 10 redesign (6 states + floating action bar) ([#104](https://github.com/alghanmi/fluxtube/issues/104)) ([5b63a0a](https://github.com/alghanmi/fluxtube/commit/5b63a0a453a9424b1be7e7b72a499639a0eff77c))
* **dashboard:** PR-D — recovery-code hero screen (state-gated Continue) ([#105](https://github.com/alghanmi/fluxtube/issues/105)) ([a60f1fe](https://github.com/alghanmi/fluxtube/commit/a60f1fe24e1826e502cf43eaae559b94fb7ad24a))
* **dashboard:** PR-E — backup restore wizard (5 numbered steps + hold-to-restore) ([#106](https://github.com/alghanmi/fluxtube/issues/106)) ([1e5d1f8](https://github.com/alghanmi/fluxtube/commit/1e5d1f8bc0511338c3b11c9696ec549e8994cb6e))

## [1.0.0](https://github.com/alghanmi/fluxtube/compare/v0.8.0...v1.0.0) (2026-07-11)


### Bug Fixes

* **dashboard/session:** SameSite=Lax on session cookie so OAuth callbacks work ([#81](https://github.com/alghanmi/fluxtube/issues/81)) ([f33647a](https://github.com/alghanmi/fluxtube/commit/f33647ae1f9e1c914004d2317f9667fb3cec87da))
* **dashboard/webauthn:** send two separate Set-Cookie headers, not join with comma ([#80](https://github.com/alghanmi/fluxtube/issues/80)) ([531c00d](https://github.com/alghanmi/fluxtube/commit/531c00dde19358b64b383409d29a9ce872cbf454))
* **dashboard/youtube:** OAuth callback redirects instead of returning raw JSON ([#82](https://github.com/alghanmi/fluxtube/issues/82)) ([2834f3b](https://github.com/alghanmi/fluxtube/commit/2834f3b248a61369188b7b326d57e2b4fdc7460d))
* **observability:** emit instance_id as a per-sample OTLP attribute, not just a resource attribute ([f37b2a1](https://github.com/alghanmi/fluxtube/commit/f37b2a1dc70eaf75c7ce81e3567f717f85ea24f1))
* **observability:** emit instance_id as per-sample OTLP attribute, not just resource attribute ([#83](https://github.com/alghanmi/fluxtube/issues/83)) ([f37b2a1](https://github.com/alghanmi/fluxtube/commit/f37b2a1dc70eaf75c7ce81e3567f717f85ea24f1))
* **sync/pass2:** stale/deleted playlist should log+skip, not throw FatalError ([#84](https://github.com/alghanmi/fluxtube/issues/84)) ([2da967b](https://github.com/alghanmi/fluxtube/commit/2da967b04ddeb7211d8a5e8218227a0e0f33831f))
* **terraform:** drop secret_text bindings — wrangler-authoritative for worker secrets (Path C) ([#77](https://github.com/alghanmi/fluxtube/issues/77)) ([d8fd934](https://github.com/alghanmi/fluxtube/commit/d8fd93423f8998a9cd5892ac9f564b758535025a))
* **terraform:** r2 lifecycle rule — max_age not max_age_seconds (v5.21 schema) ([#79](https://github.com/alghanmi/fluxtube/issues/79)) ([9ae5960](https://github.com/alghanmi/fluxtube/commit/9ae5960573f1a7c3d0f0980971dd7e30e5f34276))


### Miscellaneous Chores

* **release:** drop bump-minor-pre-major + pin v1.0.0 ([9449b60](https://github.com/alghanmi/fluxtube/commit/9449b60869ae0ed00166e7889f567f6ed07df852))

## [0.8.0](https://github.com/alghanmi/fluxtube/compare/v0.7.0...v0.8.0) (2026-07-07)


### Features

* **v1/dashboard-web:** Astro PWA frontend (Phase 6) ([#74](https://github.com/alghanmi/fluxtube/issues/74)) ([bdac224](https://github.com/alghanmi/fluxtube/commit/bdac224c2dba32df7b87419789e78cf7ab0dd657))
* **v1/dashboard:** auth plumbing — signed sessions + Bearer + /api/me + logout + recovery (Phase 4a) ([#56](https://github.com/alghanmi/fluxtube/issues/56)) ([024128c](https://github.com/alghanmi/fluxtube/commit/024128c8b748f53cebf298fd325f6fcec0064124))
* **v1/dashboard:** data endpoints — mappings, config, miniflux, sync trigger (Phase 4c) ([#68](https://github.com/alghanmi/fluxtube/issues/68)) ([cca0095](https://github.com/alghanmi/fluxtube/commit/cca00954829ac82a6580487b7701e41210ef4995))
* **v1/dashboard:** Miniflux categories + YouTube playlists + OAuth (Phase 4d) ([#69](https://github.com/alghanmi/fluxtube/issues/69)) ([5f81d46](https://github.com/alghanmi/fluxtube/commit/5f81d462256e77f890b6c6a7c15d3d8b34678cb8))
* **v1/dashboard:** Miniflux categories + YouTube playlists + YouTube OAuth (Phase 4d) ([5f81d46](https://github.com/alghanmi/fluxtube/commit/5f81d462256e77f890b6c6a7c15d3d8b34678cb8))
* **v1/dashboard:** R2 backup module + nightly cron (Phase 5) ([#73](https://github.com/alghanmi/fluxtube/issues/73)) ([5319a9f](https://github.com/alghanmi/fluxtube/commit/5319a9f644be4e4be781a02c5d5393df8ba8412c))
* **v1/dashboard:** WebAuthn passkey ceremonies (Phase 4b) ([#57](https://github.com/alghanmi/fluxtube/issues/57)) ([f83894c](https://github.com/alghanmi/fluxtube/commit/f83894c38965fc67df29c58716f5a2400e89d351))
* **v1/observability:** multi-instance Grafana + backup metrics (Phase 8) ([#76](https://github.com/alghanmi/fluxtube/issues/76)) ([c9b880d](https://github.com/alghanmi/fluxtube/commit/c9b880d1cf3acde1c625e6ce04234b9904837295))
* **v1/terraform:** multi-instance module + dashboard resources (Phase 7) ([#75](https://github.com/alghanmi/fluxtube/issues/75)) ([d0b7e72](https://github.com/alghanmi/fluxtube/commit/d0b7e72ba2e128b0c933fa29dfd9e6fa1c5e8af8))
* **v1:** AES-GCM crypto util + keychain plumbing (Phase 2) ([#54](https://github.com/alghanmi/fluxtube/issues/54)) ([7a75cde](https://github.com/alghanmi/fluxtube/commit/7a75cdeafbbf3e6515812f093b178af42ca9e262))
* **v1:** D1 schema migration + repo modules (Phase 1) ([#52](https://github.com/alghanmi/fluxtube/issues/52)) ([d39902c](https://github.com/alghanmi/fluxtube/commit/d39902c032355cdd945f4d3aa455042ca36a5bb6))
* **v1:** sync Worker dual-mode config loader (Phase 3) ([#55](https://github.com/alghanmi/fluxtube/issues/55)) ([c27539c](https://github.com/alghanmi/fluxtube/commit/c27539c146f20094403ce609a64b95016045085c))

## [0.7.0](https://github.com/alghanmi/fluxtube/compare/v0.6.0...v0.7.0) (2026-07-04)


### Features

* **v1:** scaffold workers/dashboard + dashboard/ workspaces ([1386c1a](https://github.com/alghanmi/fluxtube/commit/1386c1a34a562856b77ce2ef9315ffa426698e49))
* **v1:** scaffold workers/dashboard + dashboard/ workspaces (Phase 0) ([#50](https://github.com/alghanmi/fluxtube/issues/50)) ([1386c1a](https://github.com/alghanmi/fluxtube/commit/1386c1a34a562856b77ce2ef9315ffa426698e49))

## [0.6.0](https://github.com/alghanmi/fluxtube/compare/v0.5.1...v0.6.0) (2026-06-29)


### Features

* **site/security:** _headers upgrade for A+ on securityheaders.com ([#42](https://github.com/alghanmi/fluxtube/issues/42)) ([978823b](https://github.com/alghanmi/fluxtube/commit/978823b9c8c85c8efb4a4f0890e0ab4d981d18d8))

## [0.5.1](https://github.com/alghanmi/fluxtube/compare/v0.5.0...v0.5.1) (2026-06-28)


### Bug Fixes

* **site:** live-link cleanup, auto-year, version sync, security headers ([#40](https://github.com/alghanmi/fluxtube/issues/40)) ([a6abb46](https://github.com/alghanmi/fluxtube/commit/a6abb4601ea97932059059d7a33c16a44c345d25))

## [0.5.0](https://github.com/alghanmi/fluxtube/compare/v0.4.1...v0.5.0) (2026-06-28)


### Features

* **site:** warm-terminal dark redesign ([#38](https://github.com/alghanmi/fluxtube/issues/38)) ([bd8ef14](https://github.com/alghanmi/fluxtube/commit/bd8ef1484a162989d63c284d48f7c13158adc866))

## [0.4.1](https://github.com/alghanmi/fluxtube/compare/v0.4.0...v0.4.1) (2026-06-27)


### Bug Fixes

* **oauth-bootstrap:** route readline prompt to stderr in --json mode ([#35](https://github.com/alghanmi/fluxtube/issues/35)) ([0ff8a54](https://github.com/alghanmi/fluxtube/commit/0ff8a54cfbcb5c00cd0d1b018249200f32f80731))

## [0.4.0](https://github.com/alghanmi/fluxtube/compare/v0.3.0...v0.4.0) (2026-06-27)


### Features

* **terraform:** declare observability + read_replication in HCL ([#31](https://github.com/alghanmi/fluxtube/issues/31)) ([f520a45](https://github.com/alghanmi/fluxtube/commit/f520a45de5fe7d2165ef9303ec5767e6cef79071))

## [0.3.0](https://github.com/alghanmi/fluxtube/compare/v0.2.0...v0.3.0) (2026-06-26)


### Features

* **brand:** man-page design system for fluxtube site ([#27](https://github.com/alghanmi/fluxtube/issues/27)) ([56ed1e6](https://github.com/alghanmi/fluxtube/commit/56ed1e61be12ce723387f87d47bf8141f61492d9))
* **terraform:** migrate Cloudflare provider from ~&gt; 4.0 to ~&gt; 5.21 ([#29](https://github.com/alghanmi/fluxtube/issues/29)) ([66519ba](https://github.com/alghanmi/fluxtube/commit/66519ba7d5941fd96365406140b8f8d5734d2879))

## [0.2.0](https://github.com/alghanmi/fluxtube/compare/v0.1.2...v0.2.0) (2026-06-21)


### Features

* **oauth:** switch oauth-bootstrap to hosted callback ([#11](https://github.com/alghanmi/fluxtube/issues/11)) ([270ed35](https://github.com/alghanmi/fluxtube/commit/270ed35656c2f45278d4a2e2ad5de595560978f3))
* **site:** add OAuth callback page + privacy + terms ([#10](https://github.com/alghanmi/fluxtube/issues/10)) ([1a56339](https://github.com/alghanmi/fluxtube/commit/1a56339931f74fbdac66556190a6dbe8bde2ab56))
* **site:** scaffold fluxtube.forklabs.cc landing ([#9](https://github.com/alghanmi/fluxtube/issues/9)) ([8fe5272](https://github.com/alghanmi/fluxtube/commit/8fe5272f2243f52c80f646fcb1640c820929183b))

## [0.1.2](https://github.com/alghanmi/fluxtube-public/compare/v0.1.1...v0.1.2) (2026-06-19)


### Bug Fixes

* **release:** pin notify-deploy job to production environment ([#8](https://github.com/alghanmi/fluxtube-public/issues/8)) ([b9111cd](https://github.com/alghanmi/fluxtube-public/commit/b9111cd45fb40dda92ccb3cab4f390548987afde))
* **release:** pin release-please job to production environment ([#6](https://github.com/alghanmi/fluxtube-public/issues/6)) ([3342212](https://github.com/alghanmi/fluxtube-public/commit/3342212b1ec86856d8628adaee83f56f710da37d))

## [0.1.1](https://github.com/alghanmi/fluxtube-public/compare/v0.1.0...v0.1.1) (2026-06-19)


### Bug Fixes

* **grafana:** push dashboards into the fluxtube folder, not General ([#4](https://github.com/alghanmi/fluxtube-public/issues/4)) ([b6bcacc](https://github.com/alghanmi/fluxtube-public/commit/b6bcacc3b13d75e0f4961ed08716e307aa0e373d))
* **release:** chain deploy dispatch into release-please workflow ([#3](https://github.com/alghanmi/fluxtube-public/issues/3)) ([5aa5c21](https://github.com/alghanmi/fluxtube-public/commit/5aa5c21f712a987dd934049c2d5746bf4b44f449))

## 0.1.0 (2026-06-19)


### Features

* **observability:** Grafana dashboards + alerts as code + sync-grafana ([716b774](https://github.com/alghanmi/fluxtube-public/commit/716b774c61e56e4dfc4c79e5f92d52629eb7dfa2))
* **release:** release-please + notify-deploy dispatch ([69a3f02](https://github.com/alghanmi/fluxtube-public/commit/69a3f02422b063489a00878d5a0f711025fce45d))
* **sync:** Worker source, tests, schema + PR checks ([14768f8](https://github.com/alghanmi/fluxtube-public/commit/14768f8cde25a669f717eec9973e2f87dfee2b44))
* **terraform:** infrastructure module + production env + fmt/validate CI ([85d48e9](https://github.com/alghanmi/fluxtube-public/commit/85d48e9f6ef4aa0f383e3deb378a066327d4b551))


### Miscellaneous Chores

* pin first release to v0.1.0 ([03b3d19](https://github.com/alghanmi/fluxtube-public/commit/03b3d190b6b1460199f0458c07c016a60c73d675))
