# FluxTube dashboard PWA — design brief (Phase 10)

Brief for the v1 dashboard's visual design pass. Written for a design lead
(human or agent) coming in cold, with strong opinions and one thing they're
being asked to solve first: **a distinctive logo**.

The v1 dashboard PWA is live at `dashboard.<instance>.<domain>`. It ships
today with a functional-but-plain interface built to prove the shape works.
This pass sets its visual identity — starting with a logo, then extending
into the surface itself.

---

## The subject, in one paragraph

FluxTube is a **serverless conduit**. It watches RSS feeds inside a
Miniflux instance and, when a YouTube video shows up, quietly slides it
into a YouTube playlist. Later, when the operator watches the video and
removes it, FluxTube quietly marks the corresponding RSS entry as read.
It's plumbing — invisible when it works, deliberate when it doesn't. It
runs on Cloudflare Workers as a cron job. There's no consumer surface,
no monetization, no growth loop; there is one operator, and this
dashboard is where they configure their pipe and inspect its state.

The word "FluxTube" is the whole story:

- **Flux** — flow, motion, signal, current. Also the pre-electronic
  physics term for a bundle of magnetic field lines threading through
  a region of space (a *fluxtube* is a real object in solar physics).
- **Tube** — the conduit itself. Also the vacuum tube, the CRT, the
  broadcast heritage that YouTube inherited. And, of course, YouTube.

The name is unusually rich for a piece of infrastructure. **Lean into
it.** Nothing about the design should feel generic-SaaS.

## Personality (five words)

Quiet. Precise. Nocturnal. Handmade. Slightly old-world.

The existing marketing site (`fluxtube.forklabs.cc`) already establishes
part of this: warm-terminal dark theme, Fraunces display + IBM Plex Mono
body, ink-red accents, man-page layout devices. The dashboard should
share that world without being a copy — a marketing page is showing,
whereas a dashboard is *doing*.

## Non-goals — what this dashboard is not

- Not a consumer product. There are no growth surfaces, onboarding
  funnels, "empty state to first value" activation flows. The operator
  is opinionated and technical; treat them that way.
- Not multi-user. There is one passkey per instance; the "team"
  metaphor doesn't apply.
- Not a viewing surface. The dashboard never plays a video, never
  embeds a thumbnail, never shows a feed. YouTube is the viewing
  surface; Miniflux is the reading surface; this is the plumbing.
- Not neutral. Take a point of view. Ship one bold detail (see
  "spend your boldness" below).

---

## Priority 1 — the logo

**This is the primary ask.** Ship a mark that could not be mistaken for
another SaaS project. Reject any direction that a random observer would
call "safe" or "clean" or "modern." Those are the templated defaults;
they are the wrong answer for this brief.

### Directions to explore

Three real directions. Pick one to lead with; if a wildcard resonates,
run it in parallel and let the design pass compare on-screen.

#### A — The vacuum-tube envelope (recommended lead)

The oldest visual metaphor for "tube" in the technology canon: the
glass envelope of a broadcast vacuum tube (think 12AX7, 6V6, the guts
of a 1950s amplifier or an early television). Amber-warm glass, a
delicate filament curling inside, brass base pins at the bottom.

Why it works for FluxTube:

- The name literally has "tube" in it. Every other SaaS is trying to
  invent an abstract mark; this one has a *thing* to draw.
- Broadcast heritage rhymes with YouTube's television lineage without
  being on-the-nose. It says "we know what came before this."
- The warm amber glow harmonizes with the marketing site's palette
  (dark background, cream body, ink-red accent) — one addition, no
  conflict.
- Creates a whole visual system that other UI elements can borrow
  from: glass edges, subtle glow, the filament as a motif for
  connection-active indicators.
- Solder-flux joke lives here too. The pun is quiet enough to be a
  reward, not a groaner.

Mark ideas:

- The filament forms an idealized **F** — one continuous stroke,
  slightly asymmetric, catching a hint of glow at the loop.
- A tighter monogram version where the filament traces **FT** as a
  ligature, readable at 16×16px as a favicon.
- Companion wordmark: the tube glyph beside "FluxTube" in Fraunces,
  with the "u" in "flux" softened via Fraunces' SOFT axis to visually
  reference the tube's curve.

Risks and how to avoid them:

- Skeuomorphism trap: don't render photographically. Illustrate. One
  stroke width, two amber values maximum, no photorealistic glass
  reflections. Think engraved illustration or letterpress block, not
  Apple icon.
- Steampunk trap: no gears, no rivets, no brass filigree. The tube
  is the whole thing.

#### B — The Fraunces wordmark (recommended companion, or lead if A doesn't land)

Type-only. No pictorial glyph. The mark IS the letterforms.

Fraunces has variable-font axes for SOFT and WONK. Use them:

- Exaggerated SOFT on the "u" in **flux** — the counter opens into a
  wide bowl that reads as a channel, a curve, a *flow*. The letterform
  itself embodies the meaning.
- A companion horizontal thread — one hairline in ink-red — runs
  under the wordmark, dipping subtly at the "u" like signal
  through a filament. Thread and letterform become one composition.
- WONK dialed slightly for the final "e" — an asymmetric flourish
  that catches the eye without shouting. This is where the
  handmade signal comes from.

Why it works:

- Ties directly to the existing site typography — one design system,
  two surfaces (marketing + PWA).
- Type-driven marks age better than pictorial ones; they don't fall
  out of style with the illustration idiom of their moment.
- Scales cleanly from favicon (just "F" with the thread through the
  base) to 400px hero.

Risks:

- Fraunces + accent-line is a known move in the "warm serif SaaS"
  templated cluster. **The variable-axis exaggeration is what makes
  this specific — don't dial it back to safe.**

#### C — The fluxtube curve (wildcard)

The physics reference. In solar physics, a *fluxtube* is the geometric
region enclosed by a bundle of magnetic field lines — imagine a rope
made of curved threads, twisting slightly along its length. It has a
literal, drawable shape.

Mark ideas:

- A single hairline vector — one curved stroke, tapered at the ends,
  with a subtle twist that reads as depth. Terminates in a single
  dot at one end (the "particle" or "signal source").
- Reads as an abstract **F** at some sizes because of where the curve
  breaks.
- Rendered in ink-red on dark background, hairline weight, no fill.
  The absence of fill is the point — the tube is defined by what
  flows through it, not by the container.

Why it might work:

- Deeply on-brief without anyone recognizing the reference. Rewards
  the physics-adjacent reader (Rami's audience overlaps this).
- The most minimal of the three; would be a stunning favicon and a
  quiet, confident hero mark.
- Zero risk of skeuomorphism or steampunk drift.

Risks:

- Might read as too abstract without context. Test at small sizes
  and in a browser tab against real Cloudflare / GitHub tabs to
  confirm it holds up.

### Preferred combination

**Lead with A. Companion with B.**

- **A (vacuum tube)** as the primary mark. Wordmark + glyph together
  in the app header; glyph-only as the 32×32/16×16 favicon and
  monogram.
- **B (Fraunces wordmark)** as the marketing-site header refresh —
  ties dashboard and site into a single system without either
  looking like it's borrowing from the other.
- **C (curve)** in the back pocket. If A feels too illustrative
  after two rounds, swap the curve in as the glyph paired with B's
  wordmark. Do not merge all three — one dominant metaphor per
  execution.

### Deliverables for the logo

- Primary lockup: glyph + wordmark, horizontal.
- Glyph-only monogram: 16×16, 32×32, 128×128, 512×512, and a
  vector master.
- Favicon: 16×16 optimized specifically (may deviate from the
  monogram if legibility demands).
- Two-color palette variant (dark background) — the assumed default.
- One-color palette variant (single ink-red, for accent surfaces).
- Wordmark alone (for use where a glyph would compete).
- Motion sketch: a 300-800ms filament-warmup animation for the
  page-load moment on `/` (see Motion section below).

---

## Priority 2 — visual language for the PWA

Extending the existing marketing site's palette and typography into an
interactive surface. The site is showing; the dashboard is *doing*.
Same wardrobe, different posture.

### Palette

Start from the existing site tokens. Add restraint colors for
interactive state.

| Token                    | Purpose                            | Notes |
|---|---|---|
| `--color-bg`             | App background                     | Dark, warm-neutral (not pure black). Match the site. |
| `--color-surface`        | Cards, panels, mapping rows        | One step lighter than bg; still dark. |
| `--color-surface-raised` | Modal / drawer / dropdown surface  | Slightly lighter again. Two elevation levels total, no more. |
| `--color-ink`            | Body text                          | Warm cream, high contrast. Match the site. |
| `--color-ink-muted`      | Secondary text, labels             | Cream at ~60% opacity. |
| `--color-line`           | Hairline borders                   | Warm-gray, low contrast; the *presence* of the line matters more than its color. |
| `--color-accent`         | Primary action, active state, brand| Ink-red — the site accent. |
| `--color-accent-glow`    | Filament / active-connection glyphs| Amber (from the logo world). New addition. |
| `--color-danger`         | Destructive confirmations only     | Deeper red. Reserved. |
| `--color-success`        | Connection ok, save succeeded      | Muted forest, NOT bright acid-green. Refuse the SaaS green. |
| `--color-warning`        | Backup stale, quota approaching    | Warm ochre, borrowed from the amber. |

**Palette guardrails:**

- No bright acid-green anywhere. It's the templated-dark-SaaS default;
  it fights the warm palette.
- No pure black (`#000`) and no pure white (`#fff`). The whole
  system is warm-toned; pure values break it.
- No gradients as decoration. Gradients only when depicting
  filament glow (single directional, low chroma).
- No shadow-based elevation. Elevation is one hairline (`--color-line`)
  on the raised side. Everything is flat except the amber glow.

### Typography

Same families as the marketing site:

- **Fraunces** for display (headers, empty-state hero text, the
  recovery-code moment).
- **IBM Plex Mono** for data (mapping rows, IDs, log lines, backup
  filenames, timestamps, code samples).
- **No sans-serif.** Body copy also runs in Fraunces at a lower
  optical size (`opsz` 14-18). This is the constraint that makes
  the dashboard feel handmade rather than tooled.

Type scale — five sizes maximum:

| Token | Size | Face | Use |
|---|---|---|---|
| `--type-hero`    | 44px | Fraunces  | Signed-out state, recovery-code screen, section heroes |
| `--type-h`       | 28px | Fraunces  | Page titles, modal titles |
| `--type-body`    | 16px | Fraunces  | Paragraphs, help text |
| `--type-data`    | 14px | Plex Mono | Table cells, form fields, IDs, timestamps |
| `--type-caption` | 12px | Plex Mono | Field labels, muted metadata |

Never mix Fraunces and Plex Mono inside a single line. Whichever face
opens a line owns the whole line.

### Layout devices from the marketing site

Reuse but do not copy wholesale:

- **Man-page header bar** — the `left | center | right` pattern used
  on `/privacy` and `/terms`. Perfect for the dashboard's top nav:
  `logo | route trail | instance name`.
- **Section markers** — the manh2 sections. Use for grouping (e.g.
  "Mappings", "Backups", "Danger zone"). Do NOT use numbered markers
  (01 / 02 / 03) unless the content is a real sequence — most of the
  dashboard is not sequential.
- **See-also lists at page foot** — the muted footer that links to
  adjacent pages. Reuse for navigation between related dashboard
  sections.

---

## Priority 3 — iconography set

Small icon set, custom-drawn to fit the tube/filament visual world.
Everything is single-weight hairline (1.5px equivalent) or single-fill.
No two-tone icons. No emoji. No third-party icon libraries.

### The set to draw

Connection status (used on Miniflux instance cards + YouTube integration + backup state):

- **filament-active**  — glowing filament arc (amber). "Connection healthy, last sync green."
- **filament-idle**    — same arc, unlit (line only). "Connected but no recent activity."
- **filament-error**   — same arc, broken mid-curve, ink-red tip. "Auth failed / connection error."

Data flow:

- **rss-node**         — the origin dot representing a Miniflux category.
- **playlist-node**    — the destination stack representing a YouTube playlist.
- **flow-line**        — the arc between them; renders in ink-red when a run just added an item, muted when idle.

Actions:

- **save**, **discard**, **add**, **remove**, **duplicate** — geometric,
  single-weight, no rounded terminals unless the letterform elsewhere
  is rounded.

State glyphs:

- **encrypted**        — subtle key motif (small, muted). Sits inline
  next to any field the operator sees ciphertext-only.
- **live-fetch**       — an amber pulse (small dot with animated ring)
  for "we're fetching this from the source right now."
- **backup-fresh** / **backup-stale** — filled square / hollow square
  with a small age label alongside.

### Icon guardrails

- Every icon must work at both 16px and 24px. Draw both sizes; don't
  scale one.
- No boxes-with-lines-inside icons. No cluttered "settings gear" gears.
  If an icon needs more than five lines to read, cut it.
- If an operator can't guess what the icon means in two seconds, add
  a text label alongside. This is a dashboard for infrastructure; be
  literal.

---

## Priority 4 — screen states

The two most important screens each need a clear articulation of their
states. Design them with the states side by side; don't design only the
"happy default."

### Mapping editor

The core screen. Groups mappings by Miniflux instance, then by category.
Each row is a `(category → playlist, skip_shorts)` mapping.

States:

1. **Empty** — instance connected but no mappings yet. Show a large
   Fraunces prompt ("Route your first RSS category to a playlist.")
   with a subtle filament illustration that reinforces the mental model.
   Empty state is a chance to be visual; take it.
2. **Populated, at rest** — grouped by instance, one card per instance
   containing rows for each mapping. Row shows: category name (Plex Mono),
   an arrow, playlist title (Plex Mono), a `skip_shorts` toggle, an
   `edit` and `remove` affordance. Muted timestamp: "last synced 6m ago."
3. **Mid-edit** — one row expands in place to show its editable form.
   No modal. All edits happen in-line; save is floating at the bottom
   of the viewport when the form is dirty.
4. **Save-pending** — the floating save button shows amber filament
   pulse. Rows involved in the save are subtly muted (0.7 opacity)
   for the duration.
5. **Save-error** — the floating button turns ink-red with a short
   explanation ("Playlist ID `PL...` not found"). Never a toast.
6. **Playlist unreachable** — the row shows a `filament-error` glyph;
   hover reveals the API error message inline. This isn't an alert;
   it's ambient state.

### Recovery code screen

The single most important safety-critical moment in the whole product.
Only appears twice per instance lifetime: at initial passkey registration,
and if the operator resets and re-claims. This is the hero moment for
Fraunces; make it feel serious.

Requirements:

- **One-time view.** Once acknowledged, the operator can never see this
  code again from the dashboard. Say so plainly.
- **Presentation** — the code sits in a large Plex Mono block (36pt+),
  centered, generous whitespace around. Above it: a Fraunces `--type-hero`
  headline ("Save this recovery code."). Below it: two short paragraphs
  explaining what it is and where to keep it.
- **Bitwarden shortcut** — a small, honest hint: "Recommended: save it
  as a Note in your password manager under a Bitwarden item named
  'FluxTube / recovery / <instance>'." Not a button, not a widget.
  A sentence. Rami's stack is Bitwarden-first; this respects that.
- **Confirmation gate** — no "next" button until the operator has:
  1. Clicked "Copy to clipboard" (which flashes an amber confirmation).
  2. Actively checked a checkbox labelled "I've saved this in a place
     I trust."
  Only then does the "Continue" button appear. This is the one place
  in the whole product where UX friction is a feature.
- **After acknowledgement** — the operator is routed to `/dashboard`.
  The recovery code is gone; only its hash exists in D1. Do not offer
  a "show me again" affordance anywhere. There is no such affordance.

### Backup restore wizard

Sequential (this one really IS a sequence — use numbered markers here):

1. **Choose a backup** — list of R2 objects, newest first, with age
   ("6 hours ago" / "2 days ago"). Each row shows the payload size and
   the number of mappings + Miniflux instances it contained.
2. **Preview** — decoded payload as a table: instances, mappings,
   config. Read-only. The operator confirms this is what they think
   it is.
3. **Restore** — a warning card explaining what will happen ("The
   following will be wiped and replaced"). One long-press or
   ink-red confirm button.
4. **Re-auth wizard** — after restore, walk the operator through
   re-supplying every Miniflux API token (in `filament-error` state
   until re-supplied) and reconnecting YouTube. Sequential; each
   completion turns the corresponding `filament-error` into
   `filament-active`.
5. **Done** — a Fraunces "Restored." heading, a summary of what came
   back, and a "Return to dashboard" link.

### OAuth callback

The operator has just left the dashboard, granted YouTube consent, and
been redirected back. Two possible outcomes:

- **Success** — a short Fraunces heading ("YouTube connected."), the
  active-filament glyph, and an automatic redirect to `/dashboard/settings`
  after 1.5 seconds. Not a modal. A full page for a moment; then gone.
- **Error** — same layout, `filament-error` glyph, ink-red heading
  ("Consent declined."), and a clear "Try again" link that re-enters
  the OAuth flow.

---

## Priority 5 — motion

The whole aesthetic disciplines against motion-for-motion's-sake. There
are exactly two moments where animation is load-bearing; everything
else is instant or has a 150ms ease.

### The filament-warmup

A page-load moment on the signed-in root (`/dashboard`). The connection
status filament glyphs fade in one by one — Miniflux instances first,
then YouTube — over ~600ms, with a subtle amber warmup shimmer on each.
This is the "the machine is humming" signal. It happens once per session,
not on every navigation.

Reduced-motion: filaments render at their final state instantly.

### The save-pulse

When a save is in flight, the floating save button pulses its filament
(1s cycle, amber). Not a spinner. The filament glow *is* the loading
indicator, tying the motion vocabulary to the logo.

Reduced-motion: solid amber, no pulse.

### Everything else

- Route transitions: none. Instant.
- Hover states: color transition only, 100ms.
- Tooltips: appear at 400ms delay, disappear instantly.
- Toasts: don't use them. Errors live inline where the operator was
  looking.

---

## Priority 6 — writing (copy)

Words are design. See the frontend-design skill guidance on writing;
apply it strictly.

Voice: quiet, precise, unapologetic. This dashboard talks to an
infrastructure operator, not a consumer. Full sentences with periods
end everywhere. No exclamation marks (this includes the recovery-code
screen — gravitas doesn't need exclamation).

Concrete rules:

- "Sync now." not "Sync now!" or "Trigger sync".
- "Backup succeeded 6 minutes ago." not "Last backup: 6m".
- Errors describe what happened and what to try, in that order.
  "Playlist `PL...` returned 404. Check the playlist ID or reconnect
  YouTube."
- Never say "we" — there is no team. Say "FluxTube" or use
  no subject: "Detected a stale mapping..."
- Empty states describe what the space is for, not what to click.
- Fields are named for what the operator has, not for what the system
  wants: `Miniflux URL` not `Endpoint`, `API token` not `Bearer`.

---

## Deliverables

### For the logo pass

1. Three logo directions explored to comp fidelity (A, B, C above).
2. One recommended combination (A + B) mocked in context on the
   dashboard header, favicon slot, and marketing-site header.
3. All export formats listed under "Deliverables for the logo".
4. A one-page rationale doc — what this mark says, what it doesn't,
   why the wildcards were rejected. This is the artifact that lives
   forever; the mark is a consequence of the rationale.

### For the PWA visual language pass

1. Design tokens (color + type + spacing) exported as CSS custom
   properties matching the existing site's naming.
2. The mapping editor at every state listed above.
3. The recovery-code screen (this is a hero moment; render at
   full desktop and mobile).
4. The backup restore wizard, all five steps.
5. The OAuth callback screens, both outcomes.
6. The icon set at 16px and 24px, all glyphs listed.
7. The filament-warmup and save-pulse motion sketches (short
   video or Lottie).

### Format

- Deliver as a Figma file (or equivalent) with a page per section.
- Copy the *actual* strings that will ship — no "Lorem ipsum," no
  "Sample category → sample playlist." Use plausible category names,
  plausible playlist titles, real filenames. The copy IS the design.
- Include a `readme.md` in the file's cover page: what changed since
  the previous pass, what's open, what needs the operator's opinion.

---

## What NOT to do

Read this list before starting. Every item is a real default; refusing
them is what makes the pass worth doing.

1. **No warm cream background + high-contrast serif + terracotta
   accent.** This is one of the three templated defaults for AI-
   generated design right now. Even though FluxTube's palette overlaps
   this superficially (warm serif is present), the surface is dark and
   the accent is ink-red, not terracotta. Do not drift.
2. **No near-black background with a single acid-green accent.** The
   second templated default. Absolutely refuse acid green.
3. **No broadsheet-columns-and-hairlines layout.** The third templated
   default. The dashboard is not a newspaper.
4. **No numbered process markers (01 / 02 / 03)** unless the content
   is a real sequence. The mapping list is not; the restore wizard is.
   Use numbering only in the second case.
5. **No dashboards that look like Stripe / Linear / Grafana.** Those
   are excellent products; their design languages are theirs. FluxTube
   is not general infrastructure; it's this specific operator's
   plumbing.
6. **No "empty-state character illustration."** No cartoon robot, no
   friendly mascot, no "oops, nothing here yet." The empty states are
   invitations rendered in typography, not friendliness rendered in
   illustration.
7. **No modals for editing.** Every edit happens in-place. Modals are
   reserved for destructive confirmations (restore, key rotation)
   only.
8. **No dark-mode toggle.** The dashboard is dark. That is the
   product's choice, made deliberately. Do not put a switch in the
   corner.
9. **No favicon that's just a letter in a colored square.** The
   favicon carries the mark; if the mark can't work at 16×16, revisit
   the mark, don't defeat it with a colored square.
10. **No design system that references an existing component library.**
    Draw from first principles. If a Radix / shadcn / MUI pattern
    would be an OK answer, discard it and try again.

---

## Constraints from the engineering side

Read once; don't design around problems that aren't real.

- The dashboard runs on Cloudflare Pages backed by a Service Binding
  to a Hono Worker. Frontend is Astro 7 + Preact islands. Design in
  a way that plays nicely with island hydration: static-first, with
  interactive islands for the mapping editor and the recovery-code
  copy button.
- All text is in English. No localization surface. If the strings
  change, the design changes.
- The dashboard is single-tenant; there is no light/dark preference
  per user, no accent-color-per-user, no personalization. One
  operator, one aesthetic.
- Every asset ships from the same origin; no third-party fonts if
  they can be self-hosted. Both Fraunces and IBM Plex Mono are
  already self-hosted on the marketing site — reuse that plumbing.
- Accessibility floor: WCAG AA contrast at every foreground/background
  pairing. Visible keyboard focus on every interactive element.
  Reduced-motion respected on the filament-warmup and save-pulse.
  These are not upsells; they are the quality floor and should not
  be called out in the design deck.

---

## The one bold detail

Every design pass gets one boldness budget. Spend it on the **filament**
— the amber warmup animation, the connection-state glyph vocabulary,
the pulse on the save button. That is the thing this dashboard is
remembered for. Everything around it stays quiet.

If the design pass wants to spend the budget elsewhere, that's fine —
but *pick one*. Boldness distributed evenly is timidity.
