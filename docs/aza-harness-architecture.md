# AzA Scraper Harness — Architecture (as it stands today)

_Snapshot of what actually exists and runs right now. Honest about what is real
vs. stubbed._

## 1. What it is today

`@ares/harness` is a **scraper run orchestrator** — the "AzA" harness — living in
the M3TA monorepo (`packages/harness`). It loads accounts, routes each to a
device, and drives a per-platform automation adapter, with bounded concurrency
and per-account error isolation.

**Runs today:** the full orchestration loop, end-to-end, against **mock**
device + automation implementations. You can scrape *nothing real yet* — the
seam where real devices/automation plug in (mattclone-duo's `@julio/*`) is
defined but not connected. That's Phase 1.

```
STATUS
  Phase 0  ✅ orchestration harness + interfaces + mocks + tests   (done, verified)
  Phase 1  ⬜ @ares/harness-duo adapter → real mattclone-duo device farm
  Phase 2  ⬜ M3TA → AzA repo rename (outward-facing, GitHub redirect keeps deploy alive)
```

## 2. The pieces (files)

```
packages/harness/
├── package.json         @ares/harness — ESM, tsc -b, `demo` script
├── tsconfig.json        composite build, no cross-package refs yet
└── src/
    ├── types.ts         THE CONTRACT — all injected behavior is an interface here
    ├── runner.ts        Harness class: the orchestration loop
    ├── mocks.ts         mock impls + parseAccountsCsv (real, repo-independent)
    ├── demo.ts          runnable end-to-end proof (pnpm --filter @ares/harness demo)
    └── index.ts         public exports
tests/
└── ares-harness.test.mjs   7 tests, node --test, imports from dist/
```

## 3. The core design idea: dependency inversion at the seam

The harness contains **zero** device or platform logic. Everything it needs is an
interface in `types.ts`, injected at construction. This is what lets it run today
with mocks and connect to real infrastructure later **without changing the
runner**.

```
                         ┌───────────────────────────────┐
                         │   Harness (runner.ts)          │
                         │   - load → route → run → release│
                         │   - concurrency, error isolation│
                         └───────────────┬───────────────┘
                    injected via HarnessDeps (interfaces)
        ┌───────────────┬────────────────┼─────────────────┐
        ▼               ▼                 ▼                 ▼
  AccountSource    DeviceRouter      AutomationAdapter   SecretResolver
        │               │                 │                 │
   TODAY: mocks    TODAY: mock       TODAY: mock       TODAY: mock
   LATER: CSV/DB   LATER: duo API    LATER: duo API    LATER: macOS Keychain
```

### The interfaces (the contract)

| Interface | Responsibility | Today | Phase 1 target |
|---|---|---|---|
| `AccountSource` | list accounts (+ filter by platform/tags) | `InMemoryAccountSource` + `parseAccountsCsv` | CSV/DB loader |
| `SecretResolver` | turn a `keychain:` ref into plaintext at point of use | `MockSecretResolver` | macOS Keychain reader |
| `DeviceRouter` | acquire/release a device for an account | `MockDeviceRouter` | call mattclone-duo `@julio/device-control` |
| `AutomationAdapter` | run one task on a device (per platform) | `MockAdapter` | call mattclone-duo `@julio/automation` |

## 4. The run loop (runner.ts)

```
Harness.run(task, opts):
  accounts = AccountSource.list(opts.filter)      // load + filter
  spawn min(concurrency, N) workers, each:
    while queue not empty and not aborted:
      account = queue.shift()
      adapter = adapters[account.platform]
        └─ none? → outcome{ ok:false, "no adapter" }, no device taken
      device = DeviceRouter.acquire(account)
        └─ throws? → outcome{ ok:false, retryable }, continue
      try:
        result = adapter.run({ account, device, task, secrets, logger, signal })
      catch: outcome{ ok:false, threw }
      finally: DeviceRouter.release(device)        // ALWAYS — no leaks
  return outcomes[]   // never throws per-account
```

**Guarantees proven by tests:** batch never aborts on one failure; device
acquire/release stay balanced even through failures; unregistered platforms are
skipped without taking a device; pinned `device_name` is honored; completes fully
at concurrency 1 and N.

## 5. Data: the Account shape

Parsed from `authorized-accounts.csv` (which lives in mattclone-duo today):

```
platform,username,email,password_secret_ref,email_password_secret_ref,totp_secret_ref,device_name,tags
```
→
```ts
Account {
  platform: "instagram" | "tiktok" | "youtube"
  username, email?
  passwordRef?, emailPasswordRef?, totpRef?   // "keychain:..." — REFS, never values
  deviceName?                                  // pin to a device, optional
  tags: string[]                               // ";"-split, e.g. ["do-not-assign"]
}
```
Secrets are **never** loaded at parse time — only resolved via `SecretResolver`
at the moment an adapter needs them.

## 6. Target system topology (where this is going — Phase 1)

Recommended architecture: **two systems, one contract (service boundary).**

```
┌──────────────────────────────┐        HTTP         ┌──────────────────────────────┐
│  AzA (M3TA)  — orchestrator   │  ───────────────▶   │  mattclone-duo — device farm  │
│  @ares/harness                │                     │  apps/api + apps/worker       │
│  @ares/harness-duo  (adapter) │  ◀───────────────   │  @julio/device-control        │
│    implements DeviceRouter    │     results         │  @julio/automation            │
│    + AutomationAdapter by     │                     │  (DuoPlus / VMOS / ADB)       │
│    calling the duo API        │                     └──────────────────────────────┘
└──────────────────────────────┘
        contract = the interfaces in types.ts
```

Why service boundary over merge/submodule: mattclone-duo is actively developed,
AGPL entanglement is avoided, both sides deploy independently (zero downtime),
and `@ares/harness` never changes when the adapter's transport is later swapped.

## 7. Where it sits in the broader stack

```
M3TA (= "ares" / Garrison)  ── deployed to DO droplet 64.23.145.30, CI/CD
├── packages/garrison   always-on daemon + gateway (existing product)
├── packages/core|agent|mind|tools|protocol|...   the Ares agent runtime
└── packages/harness    ← NEW: the AzA scraper orchestrator (this doc)
```

The harness is a new, self-contained package inside the existing Ares monorepo.
It does not touch Garrison or the deployed daemon.
