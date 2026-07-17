# AzA Scraper Harness — Decision Context

> Self-contained brief for a second-opinion review. Assume no prior context.

## Goal

Build a **scraper run harness** that loads social accounts, routes each to a
physical/cloud device, and drives platform automation (Instagram / TikTok /
YouTube) to scrape. Rebrand the harness project from **M3TA → AzA**.

## The systems involved

| System | Repo / path | Role | Notes |
|---|---|---|---|
| **M3TA** (→ AzA) | `Th3Sp3ct3R/M3TA` (fork of `clout2buy/Ares`), local `/Users/growthgod/M3TA` | The harness / orchestrator | pnpm + TS monorepo, packages scoped `@ares/*`, root pkg name `ares`. Deployed as "Garrison" to a DigitalOcean droplet (64.23.145.30) with CI/CD. License AGPL-3.0. |
| **mattclone-duo** | `/Users/growthgod/VAN/mattclone-duo/mattclone_duo` | Device farm + automation | Yarn monorepo, packages scoped `@julio/*`. Has `apps/api`, `apps/worker`, `@julio/device-control` (DuoPlus/VMOS/ADB), `@julio/automation` (ig/tiktok/youtube adapters). Actively developed. Holds `authorized-accounts.csv`. |
| **instagrowth-saas** | `/Users/growthgod/VAN/instagrowth-saas` | SaaS layer (possible account mgmt UI) | Not yet wired to the harness. |

## What's already built (Phase 0 — done, verified)

New package `@ares/harness` in M3TA on branch `feat/scraper-harness` (uncommitted):

- **Interface boundary** (`types.ts`): `Account`, `AccountSource`, `SecretResolver`
  (secrets are `keychain:` *refs*, resolved lazily — never inlined), `DeviceRouter`,
  `AutomationAdapter`, `RunContext`, `RunResult`.
- **Runner** (`runner.ts`): bounded concurrency, per-account error isolation,
  guaranteed device release (even on throw), abort support.
- **Mocks + real CSV parser** (`mocks.ts`): `parseAccountsCsv` maps the exact
  `authorized-accounts.csv` columns → `Account`, honors `do-not-assign` tag.
- **Demo** (`demo.ts`): runs the full pipeline with mocks. Verified: CSV filtering,
  platform routing, pinned-device honoring, error isolation, balanced
  acquire/release (3/3, no leaks).

Nothing deployed changed. The harness runs today with zero external dependency.

## Open decision 1 — Cross-repo wiring (leaning: service boundary)

The real device/automation code (`@julio/*`) lives in the *separate* mattclone-duo
repo. Options considered: (a) git submodule, (b) merge into M3TA monorepo,
(c) private npm registry, (d) **adapter shim over a service boundary**.

**Current recommendation: (d).** Run mattclone-duo as a device-farm *service*
(`apps/api` + `apps/worker`). Write `@ares/harness-duo` — a thin adapter that
implements `DeviceRouter` + `AutomationAdapter` by calling mattclone-duo's API
over HTTP. The Phase-0 interfaces are the contract. Rationale: mattclone-duo is
actively developed (merging forks it), AGPL license entanglement avoided,
independent zero-downtime deploys, and the harness never changes when the
adapter's transport is later swapped (HTTP → published package).

**Question for reviewer:** Is the HTTP service boundary right, or does the
tighter coupling of a published-package/monorepo approach pay off sooner given a
solo/fast-moving operator? What would change your answer?

## Open decision 2 — M3TA → AzA rename (undecided)

- "M3TA" is NOT baked into package names / Dockerfile / deploy config — it appears
  only as the GitHub repo name + one workflow comment. Small footprint.
- **Zero-downtime lever:** renaming a GitHub repo leaves the old URL redirecting,
  so the droplet's `M3TA.git` remote keeps deploying uninterrupted.
- Steps would be: rename repo on GitHub → `git remote set-url` locally → rename
  local dir → update `.claude` memory path + the one workflow comment.
- Root package is named `ares` (not `m3ta`), so a deeper "should the package scope
  become `@aza/*`?" question is separate and optional.

**Question for reviewer:** Rename now or after the harness is functional? Any
hidden risk in the GitHub-redirect assumption for an SSH remote on the droplet?

## Constraints

- Secrets live in macOS Keychain (`keychain:` refs). Harness must resolve at point
  of use, never store/inline.
- M3TA is AGPL-3.0; mattclone-duo license unverified — check before any code merge.
- Droplet deploy pipeline must not break during the rename.
